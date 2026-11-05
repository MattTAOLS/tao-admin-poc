"""TAO Admin POC API. Every route in contracts/openapi.yaml, backed by the database.
Role gates: `caller` resolves the role; intake routes call tao_only / admin_only first, before touching data.
Partner tenancy: every /published/* route takes `partner_filter` as a dependency and asks `visible_programs`
which programs it may read. Those two functions are the only place partner scoping happens."""
import contextlib, copy, datetime as dt, enum, io, json, re, logging
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import Annotated, Literal
from .auth import caller, tao_only, admin_only, Caller
from .db import get_db, file_store, engine
from .jobs import get_queue
from .models import (Partner, Program, ProgramPartner, Deal, CovenantDefinition, SetrepUpload, Extraction, Finding, ReviewAction, Publication,
                     PublicationVersion, Correction, ValueEdit, new_id, utcnow)
from . import views, review, rollup, pdf, migrate, auditlog

log = logging.getLogger("api")


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    """PostgreSQL: apply pending db/migrations before serving (app/migrate.py). SQLite: nothing (tests use create_all)."""
    migrate.run(engine())
    yield


app = FastAPI(title="TAO Admin POC API", version="0.1.0", openapi_url="/api/v1/openapi.json", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
API = "/api/v1"
PERIOD = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
STATUSES = ("received", "extracting", "needs_review", "approved", "rejected", "published", "extraction_failed")


class PageDpi(enum.IntEnum):
    """Contract enum for the page image: 110 is the finding-card crop (default); the page viewer asks for 200 or 300."""
    card = 110
    sharp = 200
    sharpest = 300


PAGE_DPI = PageDpi.card


def tao_caller(c: Caller = Depends(caller)) -> Caller:
    """Resolves the role gate as a dependency so a forbidden caller gets 403 before the body is validated."""
    return tao_only(c)


def admin_caller(c: Caller = Depends(caller)) -> Caller:
    return admin_only(c)


def err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message})


@app.exception_handler(HTTPException)
async def _http_error(_: Request, e: HTTPException):
    """Contract Error shape {code, message} at the top level (FastAPI would wrap it in `detail`)."""
    body = e.detail if isinstance(e.detail, dict) and "code" in e.detail else {"code": "error", "message": str(e.detail)}
    return JSONResponse(body, status_code=e.status_code, headers=getattr(e, "headers", None))


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, e: RequestValidationError):
    return JSONResponse({"code": "invalid", "message": "request does not match the contract",
                         "errors": json.loads(json.dumps(e.errors(), default=str))}, status_code=422)


@app.get(API + "/health")
def health(): return {"ok": True, "at": dt.datetime.now(dt.timezone.utc).isoformat()}


# ---- helpers ----
def get_upload_or_404(s: Session, upload_id: str) -> SetrepUpload:
    u = s.get(SetrepUpload, upload_id) if _is_uuid(upload_id) else None
    if u is None:
        raise err(404, "not_found", "no such upload")
    return u


def _is_uuid(v: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}", v or ""))


def _check_period(p: str | None, name="period"):
    if p is not None and not PERIOD.match(p):
        raise err(422, "invalid", f"{name} must be YYYY-MM")


def _upload_dir(upload_id: str):
    return file_store() / "uploads" / upload_id


# ---- uploads (TAO) ----
@app.post(API + "/uploads", status_code=201)
async def create_upload(deal_slug: str = Form(...), collection_period: str = Form(...), file: UploadFile = File(...),
                        replace: bool = Form(False),
                        c: Caller = Depends(tao_caller), s: Session = Depends(get_db), q=Depends(get_queue)):
    tao_only(c)
    _check_period(collection_period, "collection_period")
    if s.get(Deal, deal_slug) is None:
        raise err(422, "unknown_deal", f"no deal {deal_slug}")
    published = s.scalars(select(Publication).where(Publication.deal_slug == deal_slug, Publication.collection_period == collection_period)).first()
    if published and not replace:
        raise err(409, "already_published", f"{deal_slug} {collection_period} is already published (R12); upload with replace=true for a corrected re-issue")
    if replace and not published:
        raise err(422, "nothing_to_replace", f"{deal_slug} {collection_period} has no publication to replace")
    data = await file.read()
    try:
        pages = pdf.page_count(data)
    except Exception:
        raise err(422, "not_a_pdf", "the file is not a readable PDF")
    u = SetrepUpload(id=new_id(), deal_slug=deal_slug, collection_period=collection_period, file_name=file.filename or "source.pdf",
                     file_path="", page_count=pages, uploaded_by=c.role, status="received",
                     replaces_upload_id=published.upload_id if replace else None)
    path = _upload_dir(u.id) / "source.pdf"
    u.file_path = str(path)
    s.add(u)
    try:
        s.flush()
    except IntegrityError:
        s.rollback()
        raise err(409, "upload_in_progress", f"an upload for {deal_slug} {collection_period} is already in progress")
    views.audit(s, c, "upload", upload_id=u.id, detail={"file_name": u.file_name, "page_count": pages, "collection_period": collection_period,
                                                         "replaces_upload_id": u.replaces_upload_id})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    s.commit()
    try:
        q.push({"upload_id": u.id, "pass": 1, "template_id": s.get(Deal, u.deal_slug).template_id})
    except Exception as e:                                   # queue down: say so on the upload, don't lose it silently
        log.error("queue push failed for %s: %s", u.id, e)
        u.status = "extraction_failed"
        views.audit(s, c, "extract", upload_id=u.id, reason="queue unavailable", detail={"error": str(e)[:200]})
        s.commit()
    return views.upload_dict(s, u)


@app.get(API + "/uploads")
def list_uploads(status: str | None = None, deal_slug: str | None = None, collection_period: str | None = None, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    if status is not None and status not in STATUSES:
        raise err(422, "invalid", f"status must be one of {', '.join(STATUSES)}")
    qry = select(SetrepUpload)
    if status: qry = qry.where(SetrepUpload.status == status)
    if deal_slug: qry = qry.where(SetrepUpload.deal_slug == deal_slug)
    if collection_period:
        _check_period(collection_period, "collection_period")
        qry = qry.where(SetrepUpload.collection_period == collection_period)
    return [views.upload_dict(s, u) for u in s.scalars(qry.order_by(SetrepUpload.uploaded_at.desc())).all()]


@app.get(API + "/uploads/{upload_id}")
def get_upload(upload_id: str, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    return views.upload_dict(s, get_upload_or_404(s, upload_id))


@app.get(API + "/uploads/{upload_id}/extraction")
def get_extraction(upload_id: str, pass_: int | None = Query(default=None, alias="pass", ge=1, le=2), c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    u = get_upload_or_404(s, upload_id)
    ex = views.latest_extraction(s, u.id, pass_)
    if ex is None:
        raise err(404, "not_found", "no extraction yet" if pass_ is None else f"no pass-{pass_} extraction")
    return views.extraction_dict(ex)


@app.get(API + "/uploads/{upload_id}/findings")
def get_findings(upload_id: str, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    u = get_upload_or_404(s, upload_id)
    ex = views.latest_extraction(s, u.id)
    if ex is None:
        return []
    return [views.finding_dict(f) for f in s.scalars(select(Finding).where(Finding.extraction_id == ex.id).order_by(Finding.created_at)).all()]


class OverrideRequest(BaseModel):
    choice: Literal["use_ours", "use_report", "restatement", "acknowledge"]
    reason: str = Field(min_length=3)


class ReextractRequest(BaseModel):
    pages: list[int] = Field(min_length=1)


class RejectRequest(BaseModel):
    reason: str = Field(min_length=3)


@app.post(API + "/uploads/{upload_id}/findings/{finding_id}/override")
def override(upload_id: str, finding_id: str, body: OverrideRequest, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    u = get_upload_or_404(s, upload_id)
    ex = views.latest_extraction(s, u.id)
    f = s.get(Finding, finding_id) if _is_uuid(finding_id) else None
    if ex is None or f is None or f.extraction_id != ex.id:
        raise err(404, "not_found", "no such finding on the latest extraction of this upload")
    if u.status != "needs_review":
        raise err(409, "bad_state", f"upload is {u.status}; findings can be overridden only while it needs review")
    if f.status != "open":
        raise err(409, "not_open", f"finding is already {f.status}")
    if body.choice in review.VALUE_CHOICES and not f.targets:
        raise err(409, "no_target", f"{f.rule_id} names no value to change; use restatement or acknowledge")
    review.resolve(f, body.choice, body.reason, c.role)
    views.audit(s, c, "restate" if body.choice == "restatement" else "override", upload_id=u.id, finding_id=f.id, reason=body.reason,
                detail={"choice": body.choice, "rule_id": f.rule_id, "our_value": f.our_value, "report_value": f.report_value})
    s.flush()
    findings = review.rerun(s, u, ex)
    s.commit()
    return [views.finding_dict(x) for x in findings]


@app.post(API + "/uploads/{upload_id}/reextract", status_code=202)
def reextract(upload_id: str, body: ReextractRequest, c: Caller = Depends(tao_caller), s: Session = Depends(get_db), q=Depends(get_queue)):
    tao_only(c)
    u = get_upload_or_404(s, upload_id)
    if u.status not in ("needs_review", "extraction_failed"):
        raise err(409, "bad_state", f"upload is {u.status}; re-extraction needs needs_review or extraction_failed")
    pages = sorted(set(body.pages))
    if any(p < 1 or (u.page_count and p > u.page_count) for p in pages):
        raise err(422, "invalid", f"pages must be within 1..{u.page_count or 'page count'}")
    q.push({"upload_id": u.id, "pass": 2, "pages": pages, "template_id": s.get(Deal, u.deal_slug).template_id})
    u.status = "extracting"
    views.audit(s, c, "reextract", upload_id=u.id, detail={"pages": pages})
    s.commit()
    return views.upload_dict(s, u)


@app.post(API + "/uploads/{upload_id}/approve")
def approve(upload_id: str, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    u = get_upload_or_404(s, upload_id)
    if u.status != "needs_review":
        raise err(409, "bad_state", f"upload is {u.status}; only needs_review can be approved")
    ex = views.latest_extraction(s, u.id)
    if ex is None:
        raise err(409, "no_extraction", "nothing extracted to approve")
    edits = review.active_edits(s, u.id)
    if edits:                       # findings must reflect the edits, also over a pass-2 extraction that came after them
        review.rerun(s, u, ex)
        s.commit()
    blocks = s.scalars(select(Finding).where(Finding.extraction_id == ex.id, Finding.severity == "block", Finding.status == "open")).all()
    if blocks:
        raise err(409, "open_block_findings", f"{len(blocks)} block finding(s) still open: {', '.join(sorted({b.rule_id for b in blocks}))}")
    resolved = s.scalars(select(Finding).where(Finding.extraction_id == ex.id, Finding.resolution.is_not(None)).order_by(Finding.created_at)).all()
    overrides = [f.id for f in resolved]
    try:
        published_deal, corrections = review.apply_overrides(review.apply_edits(ex.deal, edits), resolved, u.collection_period, manual=edits)
    except review.CorrectionConflict as e:
        raise HTTPException(409, {"code": "conflicting_corrections", "message": "resolved findings write different values to the "
                                  "same field: " + "; ".join(f"{x['pointer']} ({'/'.join(x['rule_ids'])})" for x in e.conflicts),
                                  "conflicts": e.conflicts})
    published_deal, manual = review.manual_corrections(ex.deal, published_deal, edits, u.collection_period)
    if any(x.get("applied") is not False for x in corrections):
        stored = s.scalars(select(Finding).where(Finding.extraction_id == ex.id)).all()
        knock_on = review.new_blocks_after_corrections(s, u, ex, published_deal, stored)
        if knock_on:
            raise HTTPException(409, {"code": "correction_inconsistent", "message": "the corrected deal raises "
                                      f"{len(knock_on)} new block finding(s): {', '.join(sorted({k['rule_id'] for k in knock_on}))}; "
                                      "use report or re-extract instead", "findings": knock_on})
    u.status = "approved"
    views.audit(s, c, "approve", upload_id=u.id, detail={"extraction_id": ex.id, "pass": ex.pass_, "overrides_used": overrides,
                                                          "corrections": corrections, "value_edits": manual})
    pub = s.scalars(select(Publication).where(Publication.deal_slug == u.deal_slug, Publication.collection_period == u.collection_period)).first()
    replaced = pub.upload_id if pub else None
    if pub is None:
        pub = Publication(upload_id=u.id, deal_slug=u.deal_slug, collection_period=u.collection_period, published_by=c.role, deal=published_deal)
        s.add(pub)
    else:                                                     # R12 replace: same (deal, period), new upload, next version
        archive_publication(s, pub)
        pub.upload_id, pub.published_by, pub.published_at, pub.deal = u.id, c.role, utcnow(), published_deal
        pub.version, pub.correction_id, pub.version_reason = (pub.version or 1) + 1, None, "corrected re-issue"
        pub.rollup_version += 1
    s.flush()
    u.status = "published"
    views.audit(s, c, "publish", upload_id=u.id, detail={"deal_slug": u.deal_slug, "collection_period": u.collection_period, "replaced_upload_id": replaced,
                                                         "version": pub.version})
    program_slug = s.get(Deal, u.deal_slug).program_slug
    views.audit(s, c, "regenerate", upload_id=u.id, detail={"program_slug": program_slug, "trigger": "approve"})
    s.commit()
    return views.upload_dict(s, u)


def archive_publication(s: Session, pub: Publication) -> None:
    """Copy the live version to publication_version before the publication is overwritten (re-issue or correction)."""
    s.add(PublicationVersion(publication_id=pub.id, version=pub.version or 1, upload_id=pub.upload_id, deal=copy.deepcopy(pub.deal),
                             published_at=pub.published_at, published_by=pub.published_by, correction_id=pub.correction_id,
                             version_reason=pub.version_reason))


Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10)]


# ---- value edits while in review (wave B) ----
class ValueEditRequest(BaseModel):
    pointer: str
    value: float
    reason: Reason


class RevertRequest(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3)]


EDITABLE = ("needs_review", "approved")


def _edit_result(s: Session, u: SetrepUpload, e: ValueEdit, ex: Extraction) -> dict:
    findings = review.rerun(s, u, ex)
    return {"edit": views.value_edit_dict(e), "finding_counts": review.finding_counts(findings)}


def _editable(s: Session, upload_id: str) -> tuple[SetrepUpload, Extraction]:
    u = get_upload_or_404(s, upload_id)
    if u.status not in EDITABLE:
        hint = "; a published report takes a correction" if u.status == "published" else ""
        raise err(409, "bad_state", f"upload is {u.status}; values can be edited only in needs_review or approved{hint}")
    ex = views.latest_extraction(s, u.id)
    if ex is None:
        raise err(409, "bad_state", "nothing extracted to edit")
    return u, ex


@app.get(API + "/uploads/{upload_id}/edits")
def list_edits(upload_id: str, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    u = get_upload_or_404(s, upload_id)
    rows = s.scalars(select(ValueEdit).where(ValueEdit.upload_id == u.id).order_by(ValueEdit.at.desc(), ValueEdit.id.desc())).all()
    return [views.value_edit_dict(e) for e in rows]


@app.post(API + "/uploads/{upload_id}/edits")
def create_edit(upload_id: str, body: ValueEditRequest, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    """One extracted number changed while in review. The extraction row is not touched; the edit is stored beside it,
    the rules re-run with every edit in force, and the value_edit audit entry names any use_ours / use_report the edit replaces."""
    admin_only(c)
    u, ex = _editable(s, upload_id)
    edits = review.active_edits(s, u.id)
    current = review.apply_edits(ex.deal, edits)
    why = review.check_number_edit(current, body.pointer, body.value)
    if why:
        raise err(422, "invalid", why)
    _, old = review.value_at(current, body.pointer)
    src = (ex.sources or {}).get(body.pointer) or {}
    e = ValueEdit(upload_id=u.id, pointer=body.pointer, old_value=float(old), new_value=body.value, reason=body.reason,
                  source_page=src.get("page") if isinstance(src, dict) else None, actor_role=c.role, actor_label=c.role, at=utcnow())
    s.add(e); s.flush()
    replaced = [f.id for f in s.scalars(select(Finding).where(Finding.extraction_id == ex.id, Finding.status == "overridden")).all()
                if (f.resolution or {}).get("choice") in review.VALUE_CHOICES and body.pointer in (f.targets or [])]
    views.audit(s, c, "value_edit", upload_id=u.id, reason=body.reason,
                detail={"edit_id": e.id, "pointer": e.pointer, "old_value": e.old_value, "new_value": e.new_value, "source_page": e.source_page,
                        "replaces_edit_id": edits[body.pointer].id if body.pointer in edits else None, "replaces_override_finding_ids": replaced})
    out = _edit_result(s, u, e, ex)
    s.commit()
    return out


@app.post(API + "/uploads/{upload_id}/edits/{edit_id}/revert")
def revert_edit(upload_id: str, edit_id: str, body: RevertRequest, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    u = get_upload_or_404(s, upload_id)
    e = s.get(ValueEdit, edit_id) if _is_uuid(edit_id) else None
    if e is None or e.upload_id != u.id or e.correction_id is not None:
        raise err(404, "not_found", "no such value edit on this upload")
    u, ex = _editable(s, upload_id)
    if e.reverted_at is not None:
        raise err(409, "already_reverted", f"edit was reverted at {views.iso(e.reverted_at)}")
    e.reverted_at, e.reverted_by, e.revert_reason = utcnow(), c.role, body.reason
    s.flush()
    now = review.active_edits(s, u.id).get(e.pointer)
    _, value_now = review.value_at(review.apply_edits(ex.deal, review.active_edits(s, u.id)), e.pointer)
    views.audit(s, c, "value_edit_revert", upload_id=u.id, reason=body.reason,
                detail={"edit_id": e.id, "pointer": e.pointer, "reverted_value": e.new_value, "value_now": value_now,
                        "edit_in_force_id": now.id if now else None})
    out = _edit_result(s, u, e, ex)
    s.commit()
    return out


# ---- corrections after publish (wave B) ----
class CorrectionEditIn(BaseModel):
    pointer: str
    value: float


class CorrectionRequest(BaseModel):
    edits: list[CorrectionEditIn] = Field(min_length=1)
    reason: Reason
    note_to_partners: str | None = Field(default=None, max_length=2000)


def _correction_or_404(s: Session, correction_id: str) -> Correction:
    k = s.get(Correction, correction_id) if _is_uuid(correction_id) else None
    if k is None:
        raise err(404, "not_found", "no such correction")
    return k


def _rerun_open_reviews(s: Session, deal_slug: str, after_period: str | None = None) -> list[str]:
    """Re-run the rules on the deal's uploads in needs_review (optionally only later periods); returns their ids."""
    q = select(SetrepUpload).where(SetrepUpload.deal_slug == deal_slug, SetrepUpload.status == "needs_review")
    if after_period:
        q = q.where(SetrepUpload.collection_period > after_period)
    ids = []
    for u in s.scalars(q.order_by(SetrepUpload.collection_period, SetrepUpload.uploaded_at)).all():
        ex = views.latest_extraction(s, u.id)
        if ex is not None:
            review.rerun(s, u, ex)
            ids.append(u.id)
    return ids


def _publish_correction(s: Session, c: Caller, k: Correction, u: SetrepUpload, pub: Publication) -> None:
    """Version n+1 goes live: the old version is archived, the corrected deal published, the roll-up regenerated, and later
    months still in review re-run, since their prior changed (risk R4)."""
    archive_publication(s, pub)
    pub.deal, pub.published_by, pub.published_at = copy.deepcopy(k.deal), c.role, utcnow()
    pub.version, pub.correction_id, pub.version_reason = k.version, k.id, k.reason
    pub.rollup_version += 1
    k.status, k.decided_at, k.decided_by = "published", utcnow(), c.role
    s.flush()
    rerun = _rerun_open_reviews(s, u.deal_slug, after_period=u.collection_period)
    views.audit(s, c, "publish", upload_id=u.id, detail={"deal_slug": u.deal_slug, "collection_period": u.collection_period, "version": k.version,
                                                         "correction_id": k.id, "rerun_upload_ids": rerun})
    views.audit(s, c, "regenerate", upload_id=u.id, detail={"program_slug": s.get(Deal, u.deal_slug).program_slug, "trigger": "correction"})


@app.get(API + "/uploads/{upload_id}/corrections")
def list_upload_corrections(upload_id: str, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    u = get_upload_or_404(s, upload_id)
    rows = s.scalars(select(Correction).where(Correction.upload_id == u.id).order_by(Correction.created_at.desc(), Correction.version.desc())).all()
    return [views.correction_dict(s, k) for k in rows]


@app.post(API + "/uploads/{upload_id}/corrections")
def create_correction(upload_id: str, body: CorrectionRequest, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    """Correct values of a published report without a new PDF. The edits apply to the live published deal and the rules
    re-run on it. No open block finding: published at once as the next version. Otherwise it waits in the approval queue
    (decision B1) and the live version stays until approve or reject."""
    admin_only(c)
    u = get_upload_or_404(s, upload_id)
    pub = s.scalars(select(Publication).where(Publication.upload_id == u.id)).first()
    if u.status != "published" or pub is None:
        why = "it was replaced by a re-issue" if u.status == "published" else f"it is {u.status}"
        raise err(409, "bad_state", f"only the live publication of a report can be corrected; {why}")
    if s.scalars(select(Correction.id).where(Correction.upload_id == u.id, Correction.status == "needs_review")).first():
        raise err(409, "correction_pending", "a correction of this report is already waiting for approval")
    pointers = [e.pointer for e in body.edits]
    if len(set(pointers)) != len(pointers):
        raise err(422, "invalid", "each pointer may appear once")
    deal = copy.deepcopy(pub.deal)
    olds = {}
    for e in body.edits:
        why = review.check_number_edit(deal, e.pointer, e.value)
        if why:
            raise err(422, "invalid", why)
        _, olds[e.pointer] = review.value_at(deal, e.pointer)
    version = (pub.version or 1) + 1
    k = Correction(id=new_id(), upload_id=u.id, publication_id=pub.id, status="needs_review", version=version, reason=body.reason,
                   note_to_partners=body.note_to_partners, deal={}, created_by=c.role, created_at=utcnow())
    s.add(k); s.flush()
    ex = views.latest_extraction(s, u.id)
    rows = []
    for i, e in enumerate(body.edits):
        box, key = review._walk(deal, e.pointer)
        box[key] = review.typed(olds[e.pointer], e.value)
        src = ((ex.sources if ex else None) or {}).get(e.pointer) or {}
        ve = ValueEdit(id=new_id(), upload_id=u.id, correction_id=k.id, pointer=e.pointer, old_value=float(olds[e.pointer]), new_value=e.value,
                       reason=body.reason, source_page=src.get("page") if isinstance(src, dict) else None, actor_role=c.role,
                       actor_label=c.role, at=k.created_at + dt.timedelta(microseconds=i))
        s.add(ve)
        # partner deal page groups data_corrections by edit_id: "Corrected by TAO · version n"
        rows.append(review.correction_entry(e.pointer, u.collection_period, olds[e.pointer], box[key], body.reason,
                                            edit_id=ve.id, correction_id=k.id, version=version, by=c.role))
    deal["data_corrections"] = list(deal.get("data_corrections") or []) + rows
    k.deal = deal
    k.findings = review.correction_findings(s, u, deal)
    k.finding_counts = review.finding_counts(k.findings)
    s.flush()
    views.audit(s, c, "correction", upload_id=u.id, reason=body.reason,
                detail={"correction_id": k.id, "version": version, "edits": [{"pointer": r_.pointer, "old_value": olds[r_.pointer], "new_value": r_.value}
                                                                             for r_ in body.edits],
                        "finding_counts": k.finding_counts, "queued": k.finding_counts["block"] > 0, "note_to_partners": body.note_to_partners})
    if k.finding_counts["block"] == 0:
        _publish_correction(s, c, k, u, pub)
    s.commit()
    return views.correction_dict(s, k)


@app.get(API + "/corrections")
def list_corrections(status: Literal["needs_review", "published", "rejected"] | None = None, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    q = select(Correction)
    if status:
        q = q.where(Correction.status == status)
    return [views.correction_dict(s, k) for k in s.scalars(q.order_by(Correction.created_at.desc(), Correction.version.desc())).all()]


@app.get(API + "/corrections/{correction_id}")
def get_correction(correction_id: str, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    return views.correction_dict(s, _correction_or_404(s, correction_id), findings=True)


@app.post(API + "/corrections/{correction_id}/approve")
def approve_correction(correction_id: str, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    """The rules re-run first (the master data or the prior month may have changed since); still a block open: 409."""
    admin_only(c)
    k = _correction_or_404(s, correction_id)
    if k.status != "needs_review":
        raise err(409, "bad_state", f"correction is {k.status}")
    u = s.get(SetrepUpload, k.upload_id)
    pub = s.get(Publication, k.publication_id)
    if pub is None or pub.upload_id != u.id or (pub.version or 1) != k.version - 1:
        raise err(409, "bad_state", "the publication changed since this correction was made (a re-issue or another version); reject it and correct again")
    k.findings = review.correction_findings(s, u, k.deal)
    k.finding_counts = review.finding_counts(k.findings)
    if k.finding_counts["block"]:
        s.commit()
        blocks = sorted({f["rule_id"] for f in k.findings if f["severity"] == "block" and f["status"] == "open"})
        raise err(409, "open_block_findings", f"{k.finding_counts['block']} block finding(s) still open: {', '.join(blocks)}")
    views.audit(s, c, "correction_approve", upload_id=u.id, detail={"correction_id": k.id, "version": k.version})
    _publish_correction(s, c, k, u, pub)
    s.commit()
    return views.correction_dict(s, k)


@app.post(API + "/corrections/{correction_id}/reject")
def reject_correction(correction_id: str, body: RejectRequest, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    k = _correction_or_404(s, correction_id)
    if k.status != "needs_review":
        raise err(409, "bad_state", f"correction is {k.status}")
    k.status, k.decided_at, k.decided_by, k.reject_reason = "rejected", utcnow(), c.role, body.reason
    views.audit(s, c, "correction_reject", upload_id=k.upload_id, reason=body.reason, detail={"correction_id": k.id, "version": k.version})
    s.commit()
    return views.correction_dict(s, k)


@app.post(API + "/uploads/{upload_id}/reject")
def reject(upload_id: str, body: RejectRequest, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    u = get_upload_or_404(s, upload_id)
    if u.status not in ("received", "extracting", "needs_review", "extraction_failed"):
        raise err(409, "bad_state", f"upload is {u.status}; it can no longer be rejected")
    u.status, u.reject_reason = "rejected", body.reason
    views.audit(s, c, "reject", upload_id=u.id, reason=body.reason)
    s.commit()
    return views.upload_dict(s, u)


@app.get(API + "/uploads/{upload_id}/pages/{n}.png")
def page_image(upload_id: str, n: int, dpi: PageDpi = PAGE_DPI, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    u = get_upload_or_404(s, upload_id)
    if n < 1 or (u.page_count and n > u.page_count):
        raise err(404, "not_found", f"page {n} is outside 1..{u.page_count}")
    src = _upload_dir(u.id) / "source.pdf"
    if not src.exists():
        raise err(404, "not_found", "the source PDF is not in the file store")
    png = _upload_dir(u.id) / "pages" / str(int(dpi)) / f"{n}.png"     # one cache per dpi: a 300 request never gets a 110 image
    pdf.render_page(src, n, png, int(dpi))              # locked + atomic: PDFium is not thread-safe
    return FileResponse(png, media_type="image/png")


@app.get(API + "/uploads/{upload_id}/file")
def get_file(upload_id: str, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    u = get_upload_or_404(s, upload_id)
    src = _upload_dir(u.id) / "source.pdf"
    if not src.exists():
        raise err(404, "not_found", "the source PDF is not in the file store")
    return FileResponse(src, media_type="application/pdf", filename=u.file_name)


# ---- master data (TAO) ----
class ProgramIn(BaseModel):
    slug: str
    name: str
    partner_slug: str | None = None
    partner_slugs: list[str] | None = Field(default=None, min_length=1)
    currency: str = "CAD"
    limit: float
    warehouse_limit: float | None = None


class DealIn(BaseModel):
    slug: str
    name: str
    program_slug: str
    servicer: str
    template_id: str


class Band(BaseModel):
    lte: float | None = None
    gt: float | None = None
    threshold: float


class ThresholdRule(BaseModel):
    on: str
    bands: list[Band]


class CovenantIn(BaseModel):
    """Body of PUT /master/covenants (contract CovenantChange). Read-only fields a client echoes back are ignored."""
    id: str | None = Field(default=None, description="mode=correct: the current row; omitted otherwise")
    mode: Literal["new_version", "correct", "add"]
    reason: Reason
    deal_slug: str
    legal_ref: str
    description: str
    kind: Literal["ceiling", "floor"]
    threshold: float | None = None
    threshold_rule: ThresholdRule | None = None
    watch_buffer_pct: float = 0.1
    effective_from: dt.date
    source: str | None = None
    unit: Literal["fraction", "ratio", "currency"] | None = None


def _master_change(s, c, entity, key, before, after):
    views.audit(s, c, "master_change", detail={"entity": entity, "key": key, "before": before, "after": after})


@app.get(API + "/master/partners")
def partners(c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    return [views.partner_dict(p) for p in s.scalars(select(Partner).order_by(Partner.slug)).all()]


@app.get(API + "/master/programs")
def programs(c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    return [views.program_dict(s, p) for p in s.scalars(select(Program).order_by(Program.slug)).all()]


@app.put(API + "/master/programs")
def put_program(body: ProgramIn, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    slugs = list(dict.fromkeys(body.partner_slugs or ([body.partner_slug] if body.partner_slug else [])))
    if not slugs:
        raise err(422, "invalid", "a program needs partner_slugs (or partner_slug)")
    for ps in slugs + ([body.partner_slug] if body.partner_slug else []):     # partner_slugs wins; a stray partner_slug must still exist
        if s.get(Partner, ps) is None:
            raise err(422, "unknown_partner", f"no partner {ps}")
    p = s.get(Program, body.slug)
    before = views.program_dict(s, p) if p else None
    if p is None:
        p = Program(slug=body.slug); s.add(p)
    for k, v in body.model_dump(exclude={"partner_slug", "partner_slugs"}).items():
        setattr(p, k, v)
    p.partner_slug = slugs[0]
    s.flush()
    views.set_partner_slugs(s, p, slugs)
    _master_change(s, c, "program", body.slug, before, views.program_dict(s, p))
    s.commit()
    return views.program_dict(s, p)


@app.get(API + "/master/deals")
def deals(program_slug: str | None = None, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    q = select(Deal)
    if program_slug: q = q.where(Deal.program_slug == program_slug)
    return [views.deal_dict(d) for d in s.scalars(q.order_by(Deal.slug)).all()]


@app.put(API + "/master/deals")
def put_deal(body: DealIn, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    if s.get(Program, body.program_slug) is None:
        raise err(422, "unknown_program", f"no program {body.program_slug}")
    d = s.get(Deal, body.slug)
    before = views.deal_dict(d) if d else None
    if d is None:
        d = Deal(slug=body.slug); s.add(d)
    for k, v in body.model_dump().items():
        setattr(d, k, v)
    s.flush()
    _master_change(s, c, "deal", body.slug, before, views.deal_dict(d))
    s.commit()
    return views.deal_dict(d)


@app.get(API + "/master/covenants")
def covenants(deal_slug: str | None = None, as_of: dt.date | None = None, include_history: bool = False,
              c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    return [views.covenant_dict(r) for r in views.covenants_as_of(s, deal_slug, as_of, include_history)]


@app.put(API + "/master/covenants")
def put_covenant(body: CovenantIn, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    """Never updates a row in place (risk R5). correct: supersede the current row, insert its replacement (same effective_from,
    supersedes_id). new_version: insert a later effective_from. add: a legal_ref new to the deal. Writes a master_change entry
    with before / after and the reason, then re-runs the rules on the deal's uploads in needs_review."""
    admin_only(c)
    if s.get(Deal, body.deal_slug) is None:
        raise err(422, "unknown_deal", f"no deal {body.deal_slug}")
    # threshold and threshold_rule may both be null: e.g. Stride SLFA 9.1 (g) CNL, whose limit is set per vintage
    current = s.scalars(select(CovenantDefinition).where(CovenantDefinition.deal_slug == body.deal_slug, CovenantDefinition.legal_ref == body.legal_ref,
                                                         CovenantDefinition.superseded_at.is_(None))
                        .order_by(CovenantDefinition.effective_from)).all()
    superseded, before = None, None
    if body.mode == "correct":
        if not body.id or not _is_uuid(body.id):
            raise err(422, "invalid", "mode=correct needs the id of the current row")
        old = s.get(CovenantDefinition, body.id)
        if old is None:
            raise err(404, "not_found", "no such covenant definition")
        if old.superseded_at is not None:
            raise err(409, "not_current", f"that row was superseded at {views.iso(old.superseded_at)}; correct the current one")
        if (old.deal_slug, old.legal_ref) != (body.deal_slug, body.legal_ref):
            raise err(422, "invalid", "deal and legal reference are fixed on a correction; add a new covenant instead")
        if old.effective_from != body.effective_from:
            raise err(422, "invalid", f"a correction keeps effective_from {old.effective_from.isoformat()}; use mode=new_version for a later date")
        before, superseded = views.covenant_dict(old), old.id
        old.superseded_at = utcnow()
    elif body.mode == "new_version":
        if not current:
            raise err(422, "invalid", f"{body.deal_slug} has no {body.legal_ref} yet; use mode=add")
        latest = current[-1]
        if body.effective_from <= latest.effective_from:
            raise err(409, "effective_not_later", f"effective_from must be later than {latest.effective_from.isoformat()}, the current version's")
        before = views.covenant_dict(latest)
    elif current:
        raise err(409, "exists", f"{body.deal_slug} already has {body.legal_ref}; edit it with new_version or correct")
    s.flush()
    data = body.model_dump(exclude={"id", "mode", "reason"})
    data["threshold_rule"] = body.threshold_rule.model_dump(exclude_none=True) if body.threshold_rule else None
    row = CovenantDefinition(id=new_id(), origin="ui", supersedes_id=superseded, changed_by=c.role, change_reason=body.reason, **data)
    s.add(row); s.flush()
    views.audit(s, c, "master_change", reason=body.reason,
                detail={"entity": "covenant_definition", "key": row.id, "mode": body.mode, "deal_slug": body.deal_slug, "legal_ref": body.legal_ref,
                        "superseded_id": superseded, "before": before, "after": views.covenant_dict(row)})
    rerun = _rerun_open_reviews(s, body.deal_slug)
    s.commit()
    return {"definition": views.covenant_dict(row), "superseded_id": superseded, "rerun_upload_ids": rerun}


# ---- published views (all roles, partner-filtered) ----
def partner_filter(c: Caller = Depends(caller)) -> str | None:
    """TAO sees everything; a partner role sees only its own partner. ONE place, used by every published route."""
    return None if c.is_tao else c.partner


def visible_programs(s: Session, partner: str | None) -> list[Program]:
    """The programs a partner sees: its rows in program_partner (004). TAO (partner None) sees every program."""
    q = select(Program).order_by(Program.slug)
    if partner is not None:
        q = q.where(Program.slug.in_(select(ProgramPartner.program_slug).where(ProgramPartner.partner_slug == partner)))
    return list(s.scalars(q).all())


def _visible_program(s: Session, partner: str | None, slug: str) -> Program:
    p = next((p for p in visible_programs(s, partner) if p.slug == slug), None)
    if p is None:                                             # another partner's program looks exactly like a missing one
        raise err(404, "not_found", f"no published program {slug}")
    return p


def _program_publications(s: Session, program_slug: str) -> list[Publication]:
    return list(s.scalars(select(Publication).join(Deal, Deal.slug == Publication.deal_slug)
                          .where(Deal.program_slug == program_slug).order_by(Publication.deal_slug)).all())


def _program_aggregate(s: Session, program: Program, period: str | None) -> dict | None:
    pubs = _program_publications(s, program.slug)
    if not pubs:
        return None
    periods = sorted({p.collection_period for p in pubs}, reverse=True)
    if period is not None and period not in periods:      # no "Sep 2026" view built only from older reports
        return None
    period = period or periods[0]
    # A program's month lists every deal: each deal contributes its latest publication at or before `period`,
    # so a deal whose next report is still waiting for approval shows its last published month (deals_behind).
    latest: dict[str, Publication] = {}
    for p in pubs:
        if p.collection_period <= period and (p.deal_slug not in latest or p.collection_period > latest[p.deal_slug].collection_period):
            latest[p.deal_slug] = p
    if not latest:
        return None
    chosen = [latest[k] for k in sorted(latest)]
    behind = [{"deal_slug": p.deal_slug, "deal_name": p.deal.get("deal_name"), "as_of": p.collection_period}
              for p in chosen if p.collection_period < period]
    agg = rollup.build_program(period, [p.deal for p in chosen])
    return {"program": views.program_dict(s, program), "available_periods": periods, "deals_behind": behind, **agg}


@app.get(API + "/published/portfolio")
def published_portfolio(partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
    out = []
    for p in visible_programs(s, partner):
        agg = _program_aggregate(s, p, None)              # carries deals_behind; each index row keeps its own collection_period
        if agg is None:
            continue
        deals_index = [{"deal_slug": d.get("deal_slug"), "deal_name": d.get("deal_name"), "collection_period": d.get("collection_period"),
                        "worst_status": d.get("worst_status"), "covenant_summary": d.get("covenant_summary"),
                        "closing_tranche_balance": (d.get("tranche_balance") or {}).get("closing")} for d in agg.pop("deals")]
        out.append({**agg, "deals": deals_index})
    return {"partner": partner, "programs": out}


@app.get(API + "/published/programs/{program_slug}")
def published_program(program_slug: str, period: str | None = None, partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
    _check_period(period)
    agg = _program_aggregate(s, _visible_program(s, partner, program_slug), period)
    if agg is None:
        raise err(404, "not_found", "nothing published for this program" + (f" in {period}" if period else ""))
    return agg


@app.get(API + "/published/programs/{program_slug}/deals/{deal_slug}")
def published_deal(program_slug: str, deal_slug: str, period: str | None = None, version: int | None = Query(default=None, ge=1),
                   partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
    _check_period(period)
    program = _visible_program(s, partner, program_slug)
    deal = s.get(Deal, deal_slug)
    if deal is None or deal.program_slug != program.slug:
        raise err(404, "not_found", f"no deal {deal_slug} in {program_slug}")
    q = select(Publication).where(Publication.deal_slug == deal_slug)
    if period: q = q.where(Publication.collection_period == period)
    pub = s.scalars(q.order_by(Publication.collection_period.desc())).first()
    if pub is None:
        raise err(404, "not_found", "nothing published for this deal" + (f" in {period}" if period else ""))
    periods = sorted(s.scalars(select(Publication.collection_period).where(Publication.deal_slug == deal_slug)).all(), reverse=True)
    versions = views.publication_versions(s, pub)
    shown = pub
    if version is not None and version != pub.version:
        shown = s.scalars(select(PublicationVersion).where(PublicationVersion.publication_id == pub.id, PublicationVersion.version == version)).first()
        if shown is None:
            raise err(404, "not_found", f"no version {version} of {deal_slug} {pub.collection_period}")
    return {**shown.deal, "published_at": views.iso(shown.published_at), "published_by": shown.published_by, "upload_id": shown.upload_id,
            "published_period": pub.collection_period, "available_periods": periods, "version": shown.version or 1, "versions": versions}


class RegenerateRequest(BaseModel):
    program_slug: str | None = None


@app.post(API + "/published/regenerate", status_code=202)
def regenerate(body: RegenerateRequest | None = None, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    """Roll-ups are computed from publication rows on every read, so they are never stale; this bumps
    rollup_version on the affected publications and records the reprocess in the audit log."""
    admin_only(c)
    slug = body.program_slug if body else None
    if slug and s.get(Program, slug) is None:
        raise err(404, "not_found", f"no program {slug}")
    slugs = [slug] if slug else [p.slug for p in s.scalars(select(Program)).all()]
    n = 0
    for ps in slugs:
        for pub in _program_publications(s, ps):
            pub.rollup_version += 1; n += 1
    views.audit(s, c, "regenerate", detail={"program_slug": slug, "programs": slugs, "publications": n, "trigger": "manual"})
    s.commit()
    return {"queued": True, "programs": slugs, "publications": n}


Scope = Literal["reports", "platform"]


def _audit_gate(c: Caller, scope: str | None) -> Caller:
    """scope=reports: tao_admin and tao_analyst. scope=platform, or no scope (both logs): tao_admin only."""
    return tao_only(c) if scope == "reports" else admin_only(c)


@app.get(API + "/audit")
def audit(upload_id: str | None = None, action: str | None = None, scope: Scope | None = None, month: str | None = None,
          q: str | None = Query(default=None, min_length=2), actor_role: str | None = None, deal_slug: str | None = None,
          limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0),
          c: Caller = Depends(caller), s: Session = Depends(get_db)):
    """Newest first. Every filter narrows; q searches across all months unless month is given."""
    _audit_gate(c, scope)
    if upload_id is not None and not _is_uuid(upload_id):
        raise err(422, "invalid", "upload_id must be a uuid")
    _check_period(month, "month")
    return auditlog.entries(s, limit, offset, scope=scope, month=month, q=q, actor_role=actor_role, deal_slug=deal_slug,
                            upload_id=upload_id, action=action)


@app.get(API + "/audit/months")
def audit_months(scope: Scope, q: str | None = Query(default=None, min_length=2), c: Caller = Depends(caller), s: Session = Depends(get_db)):
    """Entry counts per America/Toronto month for one scope, newest first (the History list); with q, matching entries only."""
    _audit_gate(c, scope)
    return auditlog.months(s, scope, q)


@app.get(API + "/audit/export.csv")
def audit_export(scope: Scope, month: str, c: Caller = Depends(caller), s: Session = Depends(get_db)):
    """One month of one scope as CSV. The export itself is recorded as an `export` entry (platform: no upload_id)."""
    _audit_gate(c, scope)
    _check_period(month, "month")
    body, n = auditlog.export_csv(s, scope, month)
    views.audit(s, c, "export", detail={"scope": scope, "month": month, "rows": n, "format": "csv"})
    s.commit()
    return Response(body, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="audit-{scope}-{month}.csv"'})
