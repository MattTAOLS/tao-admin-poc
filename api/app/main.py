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
from sqlalchemy import select, func, or_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import Annotated, Literal
from .auth import caller, tao_only, admin_only, company_admin_only, user_required, Caller, PARTNER as PARTNER_OF
from .db import get_db, file_store, engine
from .jobs import get_queue, get_news_queue
from .models import (Partner, Program, ProgramPartner, Deal, CovenantDefinition, SetrepUpload, Extraction, Finding, ReviewAction, Publication,
                     PublicationVersion, Correction, ValueEdit, AppUser, UserPref, SystemSetting, Notification, Thread, Comment, Company,
                     CompanyContact, CompanyNote, CompanyFollow, NewsRun, NewsItem, AdverseItem, new_id, utcnow)
from . import views, review, rollup, pdf, migrate, auditlog, people, notify, threads, companies, news_sources

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


def lock_upload(s: Session, upload_id: str) -> SetrepUpload:
    """The upload for a state-changing action, row-locked until the request commits (SELECT ... FOR UPDATE on PostgreSQL;
    SQLite ignores it) and read fresh, so two actions on one upload run one after the other (audit H3). The status change
    itself goes through _transition, and each action confirms the status it read with _still: both hold without the lock too."""
    u = None
    if _is_uuid(upload_id):
        u = s.scalars(select(SetrepUpload).where(SetrepUpload.id == upload_id).with_for_update()
                      .execution_options(populate_existing=True)).first()
    if u is None:
        raise err(404, "not_found", "no such upload")
    return u


def _still(s: Session, u: SetrepUpload, allowed: tuple[str, ...]) -> None:
    """Confirm in the database that the upload still is in one of `allowed` before the action does any work: a conditional
    UPDATE that changes nothing (it takes the row's write lock). A request that read the status before another one
    committed stops here with 409 bad_state, having written nothing (audit H3)."""
    held = s.execute(update(SetrepUpload).where(SetrepUpload.id == u.id, SetrepUpload.status.in_(allowed))
                     .values(status=SetrepUpload.status).execution_options(synchronize_session=False)).rowcount
    if held != 1:
        s.rollback()
        now = s.scalar(select(SetrepUpload.status).where(SetrepUpload.id == u.id))
        raise err(409, "bad_state", f"upload is {now}; another action changed it first")


def _transition(s: Session, u: SetrepUpload, allowed: tuple[str, ...], to: str, **values) -> None:
    """Move the upload to `to` only if it still is in one of `allowed`: one conditional UPDATE, so of two requests that
    both read the old status exactly one moves it; the other rolls back and gets 409 bad_state (audit H3)."""
    done = s.execute(update(SetrepUpload).where(SetrepUpload.id == u.id, SetrepUpload.status.in_(allowed)).values(status=to, **values)
                     .execution_options(synchronize_session=False)).rowcount
    if done != 1:
        s.rollback()
        now = s.scalar(select(SetrepUpload.status).where(SetrepUpload.id == u.id))
        raise err(409, "bad_state", f"upload is {now}; another action changed it first")
    s.refresh(u)


def _correction_transition(s: Session, k: Correction, to: str) -> None:
    """As _transition, for a queued correction: needs_review -> published / rejected exactly once."""
    done = s.execute(update(Correction).where(Correction.id == k.id, Correction.status == "needs_review").values(status=to)
                     .execution_options(synchronize_session=False)).rowcount
    if done != 1:
        s.rollback()
        now = s.scalar(select(Correction.status).where(Correction.id == k.id))
        raise err(409, "bad_state", f"correction is {now}; another action decided it first")
    s.refresh(k)


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
                     file_path="", page_count=pages, uploaded_by=c.role, uploaded_by_user_id=c.user_id, status="received",
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
    u = lock_upload(s, upload_id)
    ex = views.latest_extraction(s, u.id)
    f = s.get(Finding, finding_id) if _is_uuid(finding_id) else None
    if ex is None or f is None or f.extraction_id != ex.id:
        raise err(404, "not_found", "no such finding on the latest extraction of this upload")
    if u.status != "needs_review":
        raise err(409, "bad_state", f"upload is {u.status}; findings can be overridden only while it needs review")
    _still(s, u, ("needs_review",))
    s.refresh(f)
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
    """The status change is committed before the job is pushed (audit M2): a failed upload that a newer upload of the same
    deal and period has replaced cannot become active again (409 upload_in_progress), and no job is queued for it."""
    tao_only(c)
    u = lock_upload(s, upload_id)
    was = u.status
    if was not in ("needs_review", "extraction_failed"):
        raise err(409, "bad_state", f"upload is {u.status}; re-extraction needs needs_review or extraction_failed")
    _still(s, u, (was,))
    pages = sorted(set(body.pages))
    if any(p < 1 or (u.page_count and p > u.page_count) for p in pages):
        raise err(422, "invalid", f"pages must be within 1..{u.page_count or 'page count'}")
    deal_slug, period, template_id = u.deal_slug, u.collection_period, s.get(Deal, u.deal_slug).template_id
    try:
        _transition(s, u, (was,), "extracting")
        views.audit(s, c, "reextract", upload_id=u.id, detail={"pages": pages})
        s.commit()
    except IntegrityError:                                    # setrep_upload_active_period: a newer upload holds the period
        s.rollback()
        raise err(409, "upload_in_progress", f"a newer upload for {deal_slug} {period} is in progress or published; "
                                             "this one can no longer be re-extracted")
    try:
        q.push({"upload_id": u.id, "pass": 2, "pages": pages, "template_id": template_id})
    except Exception as e:                                    # queue down: put the upload back, say so, lose nothing
        log.error("queue push failed for %s: %s", u.id, e)
        _transition(s, u, ("extracting",), was)
        views.audit(s, c, "extract", upload_id=u.id, reason="queue unavailable", detail={"error": str(e)[:200], "pass": 2})
        s.commit()
        raise err(503, "queue_unavailable", "the extraction queue is not reachable; the upload is unchanged, try again")
    return views.upload_dict(s, u)


class ApproveRequest(BaseModel):
    note_to_partners: str | None = Field(default=None, max_length=2000)


@app.post(API + "/uploads/{upload_id}/approve")
def approve(upload_id: str, body: ApproveRequest | None = None, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    """Optional body {note_to_partners}: stored on the publication (its version) and sent as note_from_tao in the
    report_published notifications; the publish entry records the note and the recipients."""
    admin_only(c)
    note = body.note_to_partners if body else None
    u = lock_upload(s, upload_id)
    if u.status != "needs_review":
        raise err(409, "bad_state", f"upload is {u.status}; only needs_review can be approved")
    _still(s, u, ("needs_review",))
    ex = views.latest_extraction(s, u.id)
    if ex is None:
        raise err(409, "no_extraction", "nothing extracted to approve")
    edits = review.active_edits(s, u.id)
    # Always re-run (audit H2): the findings must reflect the value edits (also over a pass-2 extraction that came after
    # them), the master data, and the prior month as it is published now (it may have been re-issued or corrected since).
    review.rerun(s, u, ex)
    blocks = s.scalars(select(Finding).where(Finding.extraction_id == ex.id, Finding.severity == "block", Finding.status == "open")).all()
    if blocks:
        s.commit()                                            # the reviewer sees the findings the refusal is about
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
    if published_deal.get("source_file") == "source.pdf" and u.file_name:   # the stored copy's name, not the operator's file
        published_deal = {**published_deal, "source_file": u.file_name}
    _transition(s, u, ("needs_review",), "approved")
    views.audit(s, c, "approve", upload_id=u.id, detail={"extraction_id": ex.id, "pass": ex.pass_, "overrides_used": overrides,
                                                          "corrections": corrections, "value_edits": manual})
    pub = s.scalars(select(Publication).where(Publication.deal_slug == u.deal_slug, Publication.collection_period == u.collection_period)).first()
    replaced = pub.upload_id if pub else None
    if pub is None:
        pub = Publication(upload_id=u.id, deal_slug=u.deal_slug, collection_period=u.collection_period, published_by=c.role, deal=published_deal,
                          note_to_partners=note)
        s.add(pub)
    else:                                                     # R12 replace: same (deal, period), new upload, next version
        archive_publication(s, pub)
        pub.upload_id, pub.published_by, pub.published_at, pub.deal = u.id, c.role, utcnow(), published_deal
        pub.version, pub.correction_id, pub.version_reason = (pub.version or 1) + 1, None, "corrected re-issue"
        pub.note_to_partners = note
        pub.rollup_version += 1
    s.flush()
    _transition(s, u, ("approved",), "published")
    rerun = _rerun_open_reviews(s, u.deal_slug, after_period=u.collection_period)     # their prior changed (audit H2)
    told = notify.published(s, u, pub.version, c.label or c.role, note)
    views.audit(s, c, "publish", upload_id=u.id, detail={"deal_slug": u.deal_slug, "collection_period": u.collection_period, "replaced_upload_id": replaced,
                                                         "version": pub.version, "note_to_partners": note, "recipients": told,
                                                         "rerun_upload_ids": rerun})
    program_slug = s.get(Deal, u.deal_slug).program_slug
    views.audit(s, c, "regenerate", upload_id=u.id, detail={"program_slug": program_slug, "trigger": "approve"})
    s.commit()
    return views.upload_dict(s, u)


def archive_publication(s: Session, pub: Publication) -> None:
    """Copy the live version to publication_version before the publication is overwritten (re-issue or correction)."""
    s.add(PublicationVersion(publication_id=pub.id, version=pub.version or 1, upload_id=pub.upload_id, deal=copy.deepcopy(pub.deal),
                             published_at=pub.published_at, published_by=pub.published_by, correction_id=pub.correction_id,
                             version_reason=pub.version_reason, note_to_partners=pub.note_to_partners))


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
    u = lock_upload(s, upload_id)
    if u.status not in EDITABLE:
        hint = "; a published report takes a correction" if u.status == "published" else ""
        raise err(409, "bad_state", f"upload is {u.status}; values can be edited only in needs_review or approved{hint}")
    _still(s, u, EDITABLE)
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
                  source_page=src.get("page") if isinstance(src, dict) else None, actor_role=c.role, actor_label=c.label or c.role, at=utcnow())
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
    u = lock_upload(s, upload_id)
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
                detail={"edit_id": e.id, "pointer": e.pointer, "old_value": e.new_value, "new_value": value_now,
                        "reverted_value": e.new_value, "value_now": value_now,
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


def _audit_edits(s: Session, k: Correction) -> list[dict]:
    """A correction's edits as the audit page shows them: [{pointer, old_value, new_value}]."""
    rows = s.scalars(select(ValueEdit).where(ValueEdit.correction_id == k.id).order_by(ValueEdit.at, ValueEdit.id)).all()
    return [{"pointer": e.pointer, "old_value": e.old_value, "new_value": e.new_value} for e in rows]


def _correction_or_404(s: Session, correction_id: str) -> Correction:
    k = s.get(Correction, correction_id) if _is_uuid(correction_id) else None
    if k is None:
        raise err(404, "not_found", "no such correction")
    return k


def _locked_correction(s: Session, correction_id: str) -> Correction:
    """A correction for a state-changing action: its upload row is locked first (the same lock every review action on that
    report takes), then the correction is read fresh (audit H3)."""
    k = _correction_or_404(s, correction_id)
    lock_upload(s, k.upload_id)
    s.refresh(k)
    return k


def _rerun_open_reviews(s: Session, deal_slug: str, after_period: str | None = None) -> list[str]:
    """Re-run the rules on the deal's uploads in needs_review (optionally only later periods); returns their ids."""
    q = select(SetrepUpload).where(SetrepUpload.deal_slug == deal_slug, SetrepUpload.status == "needs_review")
    if after_period:
        q = q.where(SetrepUpload.collection_period > after_period)
    ids = []
    # locked like any review action, in period order: an approve of one of them waits, then sees these findings
    q = q.order_by(SetrepUpload.collection_period, SetrepUpload.uploaded_at).with_for_update().execution_options(populate_existing=True)
    for u in s.scalars(q).all():
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
    pub.note_to_partners = k.note_to_partners
    pub.rollup_version += 1
    k.status, k.decided_at, k.decided_by = "published", utcnow(), c.role
    s.flush()
    rerun = _rerun_open_reviews(s, u.deal_slug, after_period=u.collection_period)
    changes = [{"pointer": e["pointer"], "label": notify.field_label(e["pointer"]), "old_value": e["old_value"], "new_value": e["new_value"]}
               for e in _audit_edits(s, k)]
    told = notify.published(s, u, k.version, c.label or c.role, k.note_to_partners, changes=changes, correction=True)
    views.audit(s, c, "publish", upload_id=u.id, detail={"deal_slug": u.deal_slug, "collection_period": u.collection_period, "version": k.version,
                                                         "correction_id": k.id, "rerun_upload_ids": rerun, "note_to_partners": k.note_to_partners,
                                                         "recipients": told})
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
    u = lock_upload(s, upload_id)
    pub = s.scalars(select(Publication).where(Publication.upload_id == u.id)).first()
    if u.status != "published" or pub is None:
        why = "it was replaced by a re-issue" if u.status == "published" else f"it is {u.status}"
        raise err(409, "bad_state", f"only the live publication of a report can be corrected; {why}")
    _still(s, u, ("published",))
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
                       actor_label=c.label or c.role, at=k.created_at + dt.timedelta(microseconds=i))
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
                detail={"correction_id": k.id, "version": version, "edits": _audit_edits(s, k),
                        "finding_counts": k.finding_counts, "queued": k.finding_counts["block"] > 0, "note_to_partners": body.note_to_partners})
    if k.finding_counts["block"] == 0:
        _publish_correction(s, c, k, u, pub)
    else:
        notify.needs_review_queued(s, u, "Correction needs review", f"correction:{k.id}",
                                   f"Version {version} of the published report waits for approval: {k.finding_counts['block']} block finding(s). "
                                   f"By {c.label or c.role}.")
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


@app.post(API + "/corrections/{correction_id}/findings/{finding_id}/override")
def override_correction_finding(correction_id: str, finding_id: str, body: OverrideRequest, c: Caller = Depends(admin_caller),
                                s: Session = Depends(get_db)):
    """Resolve a finding of a queued correction. Only restatement or acknowledge: the correction's values are its edits,
    so use_ours / use_report are refused (409 bad_choice). The resolution sticks across the re-run approve does."""
    admin_only(c)
    k = _locked_correction(s, correction_id)
    findings = [dict(f) for f in (k.findings or [])]
    f = next((x for x in findings if x.get("id") == finding_id), None)
    if f is None:
        raise err(404, "not_found", "no such finding on this correction")
    if k.status != "needs_review":
        raise err(409, "bad_state", f"correction is {k.status}")
    if body.choice in review.VALUE_CHOICES:
        raise err(409, "bad_choice", "a correction's values are its edits; resolve with restatement or acknowledge, or reject and correct again")
    if f.get("status") != "open":
        raise err(409, "bad_state", f"finding is already {f.get('status')}")
    f["status"] = review.CHOICE_STATUS[body.choice]
    f["resolution"] = {"by": c.role, "at": views.iso(utcnow()), "choice": body.choice, "reason": body.reason}
    k.findings = findings
    k.finding_counts = review.finding_counts(findings)
    views.audit(s, c, "restate" if body.choice == "restatement" else "override", upload_id=k.upload_id, reason=body.reason,
                detail={"correction_id": k.id, "version": k.version, "correction_finding_id": f["id"], "choice": body.choice,
                        "rule_id": f.get("rule_id"), "our_value": f.get("our_value"), "report_value": f.get("report_value"),
                        "edits": _audit_edits(s, k)})
    s.commit()
    return views.correction_dict(s, k, findings=True)


@app.post(API + "/corrections/{correction_id}/approve")
def approve_correction(correction_id: str, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    """The rules re-run first (the master data or the prior month may have changed since); still a block open: 409."""
    admin_only(c)
    k = _locked_correction(s, correction_id)
    if k.status != "needs_review":
        raise err(409, "bad_state", f"correction is {k.status}")
    u = s.get(SetrepUpload, k.upload_id)
    pub = s.get(Publication, k.publication_id)
    if pub is None or pub.upload_id != u.id or (pub.version or 1) != k.version - 1:
        raise err(409, "bad_state", "the publication changed since this correction was made (a re-issue or another version); reject it and correct again")
    k.findings = review.correction_findings(s, u, k.deal, previous=k.findings)
    k.finding_counts = review.finding_counts(k.findings)
    if k.finding_counts["block"]:
        s.commit()
        blocks = sorted({f["rule_id"] for f in k.findings if f["severity"] == "block" and f["status"] == "open"})
        raise err(409, "open_block_findings", f"{k.finding_counts['block']} block finding(s) still open: {', '.join(blocks)}")
    _correction_transition(s, k, "published")              # flushes the re-run findings first
    views.audit(s, c, "correction_approve", upload_id=u.id, detail={"correction_id": k.id, "version": k.version, "edits": _audit_edits(s, k)})
    _publish_correction(s, c, k, u, pub)
    s.commit()
    return views.correction_dict(s, k)


@app.post(API + "/corrections/{correction_id}/reject")
def reject_correction(correction_id: str, body: RejectRequest, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    k = _locked_correction(s, correction_id)
    if k.status != "needs_review":
        raise err(409, "bad_state", f"correction is {k.status}")
    _correction_transition(s, k, "rejected")
    k.decided_at, k.decided_by, k.reject_reason = utcnow(), c.role, body.reason
    views.audit(s, c, "correction_reject", upload_id=k.upload_id, reason=body.reason,
                detail={"correction_id": k.id, "version": k.version, "edits": _audit_edits(s, k)})
    notify.rejected(s, s.get(SetrepUpload, k.upload_id), body.reason, c.label or c.role, what="Correction")
    s.commit()
    return views.correction_dict(s, k)


@app.post(API + "/uploads/{upload_id}/reject")
def reject(upload_id: str, body: RejectRequest, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    u = lock_upload(s, upload_id)
    rejectable = ("received", "extracting", "needs_review", "extraction_failed")
    if u.status not in rejectable:
        raise err(409, "bad_state", f"upload is {u.status}; it can no longer be rejected")
    _still(s, u, rejectable)
    _transition(s, u, rejectable, "rejected", reject_reason=body.reason)
    views.audit(s, c, "reject", upload_id=u.id, reason=body.reason)
    notify.rejected(s, u, body.reason, c.label or c.role)
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
    row = CovenantDefinition(id=new_id(), origin="ui", supersedes_id=superseded, changed_by=c.role, change_reason=body.reason,
                             changed_at=utcnow(), **data)
    s.add(row); s.flush()
    views.audit(s, c, "master_change", reason=body.reason,
                detail={"entity": "covenant_definition", "key": row.id, "mode": body.mode, "deal_slug": body.deal_slug, "legal_ref": body.legal_ref,
                        "effective_from": body.effective_from.isoformat(),
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
          q: str | None = Query(default=None, min_length=2), actor_role: str | None = None, actor_user_id: str | None = None,
          deal_slug: str | None = None, limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0),
          c: Caller = Depends(caller), s: Session = Depends(get_db)):
    """Newest first. Every filter narrows; q searches across all months unless month is given. actor_user_id equal to the
    caller's own user (Profile, My activity) is readable by every role; anyone else's needs the scope rule."""
    if actor_user_id is not None and not _is_uuid(actor_user_id):
        raise err(422, "invalid", "actor_user_id must be a uuid")
    if not (actor_user_id is not None and c.user_id is not None and actor_user_id.lower() == c.user_id):
        _audit_gate(c, scope)
    if upload_id is not None and not _is_uuid(upload_id):
        raise err(422, "invalid", "upload_id must be a uuid")
    _check_period(month, "month")
    return auditlog.entries(s, limit, offset, scope=scope, month=month, q=q, actor_role=actor_role, deal_slug=deal_slug,
                            upload_id=upload_id, action=action, actor_user_id=actor_user_id.lower() if actor_user_id else None)


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


# ---- wave C: people (users, subscriptions, /me, prefs, settings) ----
def _refused(e: people.Refused) -> HTTPException:
    return err(e.status, e.code, e.message)


def user_caller(c: Caller = Depends(caller)) -> Caller:
    return user_required(c)


def list_users_caller(c: Caller = Depends(caller), partner_slug: str | None = None, status: str | None = None,
                      q: str | None = None) -> Caller:
    """GET /users: as users_caller, except that a tao_analyst may ask for exactly partner_slug=tao&status=active (the
    @mention list)."""
    if c.role == "tao_analyst" and partner_slug == "tao" and status == "active" and q is None:
        return c
    return company_admin_only(c)


def users_caller(c: Caller = Depends(caller)) -> Caller:
    """tao_admin, or a partner's Company Admin (scoped to its partner in _user_in_scope); others 403 company_admin_only."""
    return company_admin_only(c)


def _me(s: Session, c: Caller) -> AppUser | None:
    return s.get(AppUser, c.user_id) if c.user_id else None


def _user_in_scope(s: Session, c: Caller, user_id: str) -> AppUser:
    """The user, if the caller may manage them: tao_admin any, a Company Admin only its own partner's (else 404, as missing)."""
    u = s.get(AppUser, user_id) if _is_uuid(user_id) else None
    if u is None or (not c.is_admin and u.partner_slug != c.partner):
        raise err(404, "not_found", "no such user")
    return u


def _user_change(s: Session, c: Caller, u: AppUser, change: str, before, after, reason: str | None = None):
    views.audit(s, c, "user_change", reason=reason, detail={"user_id": u.id, "email": u.email, "name": u.name, "partner_slug": u.partner_slug,
                                                           "change": change, "before": before, "after": after})


def _me_dict(s: Session, c: Caller) -> dict:
    u = _me(s, c)
    return {"user": people.user_dict(s, u) if u else None, "role": c.role, "partner_slug": c.partner if not c.is_tao else None,
            "display": people.display(s, u), "features": {"companies": c.is_tao or _profiles_on(s)}}


class AppUserCreate(BaseModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    role: Literal["tao_admin", "tao_analyst", "investor_admin", "investor_viewer", "manager_admin", "manager_viewer"]
    partner_slug: str | None = None


class AppUserPatch(BaseModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")] | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None = None
    role: Literal["tao_admin", "tao_analyst", "investor_admin", "investor_viewer", "manager_admin", "manager_viewer"] | None = None
    partner_slug: str | None = None


class StatusChangeRequest(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3)]


class SubscriptionIn(BaseModel):
    program_slug: str
    deal_slug: str | None = None
    channels: list[Literal["in_app", "email"]] = Field(min_length=1)


class MePatch(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None = None
    time_zone: str | None = None
    date_format: Literal["D MMM YYYY", "YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"] | None = None
    number_format: Literal["1,234.56", "1 234,56"] | None = None


class NotificationPrefIn(BaseModel):
    kind: str
    in_app: bool
    digest: Literal["instant", "daily"]


class SettingChange(BaseModel):
    value: object = None
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3)]


@app.get(API + "/me")
def get_me(c: Caller = Depends(caller), s: Session = Depends(get_db)):
    return _me_dict(s, c)


@app.patch(API + "/me")
def patch_me(body: MePatch, c: Caller = Depends(user_caller), s: Session = Depends(get_db)):
    """Own name and display settings. Role, email and partner are not self-editable (not in the body)."""
    fields = body.model_dump(exclude_unset=True)
    if not fields or any(v is None for v in fields.values()):
        raise err(422, "invalid", "send at least one of name, time_zone, date_format, number_format (not null)")
    try:
        if "time_zone" in fields:
            people.check_time_zone(fields["time_zone"])
    except people.Refused as e:
        raise _refused(e)
    u = _me(s, c)
    before = {"name": u.name, **people.display(s, u)}
    if "name" in fields:
        u.name = fields.pop("name")
    if fields:
        p = s.get(UserPref, u.id)
        if p is None:
            p = UserPref(user_id=u.id); s.add(p)
        for k, v in fields.items():
            setattr(p, k, v)
        p.updated_at = utcnow()
    s.flush()
    after = {"name": u.name, **people.display(s, u)}
    c.label = u.name
    views.audit(s, c, "prefs_change", detail={"user_id": u.id, "before": before, "after": after})
    s.commit()
    return _me_dict(s, c)


@app.get(API + "/me/notification-prefs")
def get_my_prefs(c: Caller = Depends(user_caller), s: Session = Depends(get_db)):
    return people.prefs(s, _me(s, c))


@app.put(API + "/me/notification-prefs")
def put_my_prefs(body: list[NotificationPrefIn], c: Caller = Depends(user_caller), s: Session = Depends(get_db)):
    """Kinds left out go back to the defaults. covenant_changed / correction_published off: 422 required."""
    u = _me(s, c)
    before = people.prefs(s, u)
    try:
        people.set_prefs(s, u, [b.model_dump() for b in body])
    except people.Refused as e:
        s.rollback()
        raise _refused(e)
    after = people.prefs(s, u)
    views.audit(s, c, "prefs_change", detail={"user_id": u.id, "before": {"notification_prefs": before}, "after": {"notification_prefs": after}})
    s.commit()
    return after


@app.get(API + "/users")
def list_users(partner_slug: str | None = None, status: Literal["active", "deactivated"] | None = None,
               q: str | None = Query(default=None, min_length=2), c: Caller = Depends(list_users_caller), s: Session = Depends(get_db)):
    """tao_admin: everyone (partner_slug=tao: TAO users). A Company Admin: its own partner only, whatever partner_slug says.
    A tao_analyst: only partner_slug=tao&status=active, as {id, name, email, role, status} (the @mention list)."""
    qry = select(AppUser)
    scope = c.partner if c.is_company_admin else partner_slug          # the analyst gate allows only tao
    if scope == "tao":
        qry = qry.where(AppUser.partner_slug.is_(None))
    elif scope is not None:
        qry = qry.where(AppUser.partner_slug == scope)
    if status:
        qry = qry.where(AppUser.status == status)
    if q:
        pat = "%" + q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        qry = qry.where(or_(func.lower(AppUser.name).like(pat, escape="\\"), func.lower(AppUser.email).like(pat, escape="\\")))
    rows = s.scalars(qry.order_by(AppUser.partner_slug.is_not(None), AppUser.partner_slug, AppUser.name)).all()
    if not (c.is_admin or c.is_company_admin):                  # the analyst's @mention list
        return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role, "status": u.status} for u in rows]
    return [people.user_dict(s, u) for u in rows]


@app.post(API + "/users", status_code=201)
def create_user(body: AppUserCreate, c: Caller = Depends(users_caller), s: Session = Depends(get_db)):
    """Active, no subscriptions. A Company Admin adds only its own partner's admin or viewer (409 other_partner)."""
    try:
        people.check_company_admin_scope(c, body.role, body.partner_slug)
        people.check_role_partner(s, body.role, body.partner_slug)
        if people.email_taken(s, body.email):
            raise people.Refused(409, "email_taken", f"{body.email} is already a user")
    except people.Refused as e:
        raise _refused(e)
    u = AppUser(id=new_id(), email=body.email.lower(), name=body.name, role=body.role, partner_slug=body.partner_slug, status="active",
                created_at=utcnow())
    s.add(u)
    try:
        s.flush()
    except IntegrityError:
        s.rollback()
        raise err(409, "email_taken", f"{body.email} is already a user")
    _user_change(s, c, u, "created", None, people.user_audit(u))
    notify.user_changed(s, u, "Your account was created", f"By {c.label or c.role}. Role: {u.role}.")
    s.commit()
    return people.user_dict(s, u)


@app.get(API + "/users/{user_id}")
def get_user(user_id: str, c: Caller = Depends(users_caller), s: Session = Depends(get_db)):
    return people.user_dict(s, _user_in_scope(s, c, user_id))


@app.patch(API + "/users/{user_id}")
def patch_user(user_id: str, body: AppUserPatch, c: Caller = Depends(users_caller), s: Session = Depends(get_db)):
    """Name, email, role or partner. Not your own role or partner (409 self_change); never the last active tao_admin or a
    partner's last active Company Admin (409 last_admin). partner_slug left out follows the role (TAO: none; investor_* /
    manager_*: that partner)."""
    u = _user_in_scope(s, c, user_id)
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise err(422, "invalid", "send at least one of email, name, role, partner_slug")
    if any(fields.get(k) is None for k in ("email", "name", "role") if k in fields):
        raise err(422, "invalid", "email, name and role cannot be null")
    role = fields.get("role", u.role)
    partner = fields["partner_slug"] if "partner_slug" in fields else (u.partner_slug if role == u.role else PARTNER_OF.get(role))
    try:
        people.check_company_admin_scope(c, role, partner)
        if u.id == c.user_id and (role != u.role or partner != u.partner_slug):
            raise people.Refused(409, "self_change", "you cannot change your own role or partner")
        if "email" in fields and people.email_taken(s, fields["email"], other_than=u.id):
            raise people.Refused(409, "email_taken", f"{fields['email']} is already a user")
        people.check_role_partner(s, role, partner)
        if people.is_last_admin(s, u, role, partner, u.status):
            raise people.Refused(409, "last_admin", "this would leave no active tao_admin (or the partner without an active Company Admin)")
    except people.Refused as e:
        raise _refused(e)
    before = people.user_audit(u)
    if "email" in fields:
        u.email = fields["email"].lower()
    if "name" in fields:
        u.name = fields["name"]
    u.role, u.partner_slug = role, partner
    s.flush()
    after = people.user_audit(u)
    if after != before:
        _user_change(s, c, u, "updated", before, after)
        changed = ", ".join(k for k in after if after[k] != before[k])
        notify.user_changed(s, u, "Your account was changed", f"{changed.capitalize()} changed by {c.label or c.role}.")
    s.commit()
    return people.user_dict(s, u)


@app.post(API + "/users/{user_id}/deactivate")
def deactivate_user(user_id: str, body: StatusChangeRequest, c: Caller = Depends(users_caller), s: Session = Depends(get_db)):
    u = _user_in_scope(s, c, user_id)
    try:
        if u.id == c.user_id:
            raise people.Refused(409, "self_change", "you cannot deactivate yourself")
        if u.status == "deactivated":
            raise people.Refused(409, "already_deactivated", "this user is already deactivated")
        if people.is_last_admin(s, u, u.role, u.partner_slug, "deactivated"):
            raise people.Refused(409, "last_admin", "this would leave no active tao_admin (or the partner without an active Company Admin)")
    except people.Refused as e:
        raise _refused(e)
    before = people.user_audit(u)
    u.status, u.deactivated_at, u.deactivation_reason = "deactivated", utcnow(), body.reason
    s.flush()
    _user_change(s, c, u, "deactivated", before, people.user_audit(u), reason=body.reason)
    s.commit()
    return people.user_dict(s, u)


@app.post(API + "/users/{user_id}/reactivate")
def reactivate_user(user_id: str, body: StatusChangeRequest, c: Caller = Depends(users_caller), s: Session = Depends(get_db)):
    u = _user_in_scope(s, c, user_id)
    if u.status == "active":
        raise err(409, "already_active", "this user is already active")
    before = people.user_audit(u)
    u.status, u.deactivated_at, u.deactivation_reason = "active", None, None
    s.flush()
    _user_change(s, c, u, "reactivated", before, people.user_audit(u), reason=body.reason)
    notify.user_changed(s, u, "Your account was reactivated", f"By {c.label or c.role}.")
    s.commit()
    return people.user_dict(s, u)


@app.get(API + "/users/{user_id}/subscriptions")
def get_subscriptions(user_id: str, c: Caller = Depends(caller), s: Session = Depends(get_db)):
    """tao_admin; a Company Admin for its own partner's users; the user themselves (read-only)."""
    if c.user_id is None or c.user_id != user_id:
        company_admin_only(c)
        u = _user_in_scope(s, c, user_id)
    else:
        u = s.get(AppUser, user_id)
    return [people.subscription_dict(x) for x in people.subscriptions(s, u.id)]


@app.put(API + "/users/{user_id}/subscriptions")
def put_subscriptions(user_id: str, body: list[SubscriptionIn], c: Caller = Depends(users_caller), s: Session = Depends(get_db)):
    u = _user_in_scope(s, c, user_id)
    try:
        rows = people.check_subscriptions(s, u, body)
    except people.Refused as e:
        raise _refused(e)
    before = [people.subscription_dict(x) for x in people.subscriptions(s, u.id)]
    people.replace_subscriptions(s, u, rows)
    after = [people.subscription_dict(x) for x in people.subscriptions(s, u.id)]
    if after != before:
        _user_change(s, c, u, "subscriptions", before, after)
        notify.user_changed(s, u, "Your report subscriptions changed", f"You now receive: {people.receives_summary(s, u.id)}. By {c.label or c.role}.")
    s.commit()
    return after


@app.get(API + "/settings")
def get_settings(c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    return [people.setting_dict(s, k) for k in people.SETTING_KEYS]


@app.put(API + "/settings/{key}")
def put_setting(key: str, body: SettingChange, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    if key not in people.SETTING_KEYS:
        raise err(422, "unknown_setting", f"no setting {key}")
    try:
        value = people.check_setting(s, key, body.value)
    except people.Refused as e:
        raise _refused(e)
    before = people.get_setting(s, key)
    row = s.get(SystemSetting, key)
    if row is None:
        row = SystemSetting(key=key); s.add(row)
    row.value, row.updated_at, row.updated_by = value, utcnow(), c.label or c.role
    s.flush()
    views.audit(s, c, "settings_change", reason=body.reason, detail={"key": key, "before": before, "after": value})
    s.commit()
    return people.setting_dict(s, key)


# ---- wave C: notifications (every role, own only, partner-filtered on read: risk R7) ----
Tab = Literal["all", "mentions", "reports", "system"]


def _my_notifications(s: Session, c: Caller, partner: str | None, tab: str = "all"):
    """The caller's own notifications. A partner's go through partner_filter again: partner kinds only, and only deals of
    programs visible_programs gives them now, so a program TAO stops sharing drops out (and no TAO comment ever shows)."""
    q = select(Notification).where(Notification.user_id == c.user_id)
    if partner is not None or not c.is_tao:
        q = notify.visible_to_partner(q, [p.slug for p in visible_programs(s, partner)])
        if not _profiles_on(s):                           # company profiles switched off: their alerts go quiet too
            q = q.where(Notification.kind.not_in(people.COMPANY_KINDS))
    if tab != "all":
        q = q.where(Notification.kind.in_(people.TABS[tab]))
    return q


@app.get(API + "/notifications")
def list_notifications(tab: Tab = "all", unread: bool | None = None, limit: int = Query(default=50, ge=1, le=200),
                       offset: int = Query(default=0, ge=0), c: Caller = Depends(user_caller),
                       partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
    notify.sweep(s)
    q = _my_notifications(s, c, partner, tab)
    if unread is True:
        q = q.where(Notification.read_at.is_(None))
    elif unread is False:
        q = q.where(Notification.read_at.is_not(None))
    rows = s.scalars(q.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).offset(offset)).all()
    return [notify.notification_dict(n) for n in rows]


@app.get(API + "/notifications/unread-count")
def unread_count(c: Caller = Depends(user_caller), partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
    notify.sweep(s)
    kinds = s.scalars(_my_notifications(s, c, partner).where(Notification.read_at.is_(None)).with_only_columns(Notification.kind)).all()
    out = {tab: sum(1 for k in kinds if k in ks) for tab, ks in people.TABS.items()}
    return {"total": len(kinds), **out}


@app.post(API + "/notifications/{notification_id}/read")
def read_notification(notification_id: str, c: Caller = Depends(user_caller), partner: str | None = Depends(partner_filter),
                      s: Session = Depends(get_db)):
    n = s.scalars(_my_notifications(s, c, partner).where(Notification.id == notification_id)).first() if _is_uuid(notification_id) else None
    if n is None:                                         # another person's looks exactly like a missing one
        raise err(404, "not_found", "no such notification")
    if n.read_at is None:
        n.read_at = utcnow()
        s.commit()
    return notify.notification_dict(n)


@app.post(API + "/notifications/read-all")
def read_all_notifications(tab: Tab = "all", c: Caller = Depends(user_caller), partner: str | None = Depends(partner_filter),
                           s: Session = Depends(get_db)):
    rows = s.scalars(_my_notifications(s, c, partner, tab).where(Notification.read_at.is_(None))).all()
    now = utcnow()
    for n in rows:
        n.read_at = now
    s.commit()
    return {"marked": len(rows)}


@app.get(API + "/uploads/{upload_id}/recipients")
def upload_recipients(upload_id: str, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    """Who a publish (or a correction) of this upload's deal would notify, and who not and why."""
    u = get_upload_or_404(s, upload_id)
    return notify.recipients(s, u.deal_slug)


# ---- wave C: comment threads (TAO only; writes need a user) ----
def tao_user_caller(c: Caller = Depends(caller)) -> Caller:
    return user_required(tao_only(c))


class ThreadAnchorIn(BaseModel):
    finding_id: str | None = None
    pointer: str | None = None


class ThreadCreate(BaseModel):
    anchor: ThreadAnchorIn
    body: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    mentions: list[str] = Field(default_factory=list)


class CommentRequest(BaseModel):
    body: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    mentions: list[str] = Field(default_factory=list)


def _thread_or_404(s: Session, thread_id: str) -> Thread:
    t = s.get(Thread, thread_id) if _is_uuid(thread_id) else None
    if t is None:
        raise err(404, "not_found", "no such thread")
    return t


def _comment_audit(s: Session, c: Caller, t: Thread, cm: Comment):
    views.audit(s, c, "comment", upload_id=t.upload_id, detail={"thread_id": t.id, "comment_id": cm.id, "anchor": threads.anchor(t),
                                                               "body": cm.body, "mentions": list(cm.mentions or [])})


@app.get(API + "/uploads/{upload_id}/threads")
def list_threads(upload_id: str, status: Literal["open", "resolved"] | None = None, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    u = get_upload_or_404(s, upload_id)
    return [threads.thread_dict(s, t) for t in threads.threads_of(s, u, status)]


@app.post(API + "/uploads/{upload_id}/threads", status_code=201)
def create_thread(upload_id: str, body: ThreadCreate, c: Caller = Depends(tao_user_caller), s: Session = Depends(get_db)):
    u = get_upload_or_404(s, upload_id)
    try:
        finding_id, pointer, rule_id = threads.check_anchor(s, u, body.anchor.finding_id, body.anchor.pointer)
        mentions = threads.check_mentions(s, body.mentions)
    except people.Refused as e:
        raise _refused(e)
    pub = s.scalars(select(Publication).where(Publication.upload_id == u.id)).first()
    now = utcnow()
    t = Thread(id=new_id(), upload_id=u.id, finding_id=finding_id, pointer=pointer, rule_id=rule_id, status="open",
               version=views.published_version(s, u, pub), created_by=c.user_id, created_at=now)
    s.add(t); s.flush()
    cm = Comment(id=new_id(), thread_id=t.id, author_id=c.user_id, body=body.body, mentions=mentions, created_at=now)
    s.add(cm); s.flush()
    _comment_audit(s, c, t, cm)
    threads.notify_comment(s, t, cm, s.get(AppUser, c.user_id), mentions, reply=False)
    s.commit()
    return threads.thread_dict(s, t)


@app.post(API + "/threads/{thread_id}/comments", status_code=201)
def add_comment(thread_id: str, body: CommentRequest, c: Caller = Depends(tao_user_caller), s: Session = Depends(get_db)):
    t = _thread_or_404(s, thread_id)
    if t.status != "open":
        raise err(409, "bad_state", "the thread is resolved; reopen it first")
    try:
        mentions = threads.check_mentions(s, body.mentions)
    except people.Refused as e:
        raise _refused(e)
    cm = Comment(id=new_id(), thread_id=t.id, author_id=c.user_id, body=body.body, mentions=mentions, created_at=utcnow())
    s.add(cm); s.flush()
    _comment_audit(s, c, t, cm)
    threads.notify_comment(s, t, cm, s.get(AppUser, c.user_id), mentions, reply=True)
    s.commit()
    return threads.comment_dict(s, cm)


@app.patch(API + "/comments/{comment_id}")
def edit_comment(comment_id: str, body: CommentRequest, c: Caller = Depends(tao_user_caller), s: Session = Depends(get_db)):
    """Author only. Shown as edited; the old text stays in the comment_edit audit entry. Only newly added mentions notify."""
    cm = s.get(Comment, comment_id) if _is_uuid(comment_id) else None
    if cm is None:
        raise err(404, "not_found", "no such comment")
    if cm.author_id != c.user_id:
        raise err(403, "not_author", "only the author can edit a comment")
    try:
        mentions = threads.check_mentions(s, body.mentions)
    except people.Refused as e:
        raise _refused(e)
    t = s.get(Thread, cm.thread_id)
    before = {"body": cm.body, "mentions": list(cm.mentions or [])}
    added = [m for m in mentions if m not in before["mentions"]]
    cm.body, cm.mentions, cm.edited_at = body.body, mentions, utcnow()
    s.flush()
    views.audit(s, c, "comment_edit", upload_id=t.upload_id, detail={"thread_id": t.id, "comment_id": cm.id, "before": before,
                                                                    "after": {"body": cm.body, "mentions": mentions}})
    threads.notify_comment(s, t, cm, s.get(AppUser, c.user_id), added, reply=False)
    s.commit()
    return threads.comment_dict(s, cm)


def _resolver(c: Caller, t: Thread):
    """Any TAO Admin, or the person who started the thread (decision C10)."""
    if not (c.is_admin or t.created_by == c.user_id):
        raise err(403, "forbidden", "only a TAO Admin or the person who started the thread can resolve or reopen it")


@app.post(API + "/threads/{thread_id}/resolve")
def resolve_thread(thread_id: str, c: Caller = Depends(tao_user_caller), s: Session = Depends(get_db)):
    t = _thread_or_404(s, thread_id)
    _resolver(c, t)
    if t.status == "resolved":
        raise err(409, "bad_state", "the thread is already resolved")
    t.status, t.resolved_by, t.resolved_at = "resolved", c.user_id, utcnow()
    views.audit(s, c, "thread_resolve", upload_id=t.upload_id, detail={"thread_id": t.id})
    s.commit()
    return threads.thread_dict(s, t)


@app.post(API + "/threads/{thread_id}/reopen")
def reopen_thread(thread_id: str, c: Caller = Depends(tao_user_caller), s: Session = Depends(get_db)):
    t = _thread_or_404(s, thread_id)
    _resolver(c, t)
    if t.status == "open":
        raise err(409, "bad_state", "the thread is already open")
    t.status, t.resolved_by, t.resolved_at = "open", None, None
    views.audit(s, c, "thread_reopen", upload_id=t.upload_id, detail={"thread_id": t.id})
    s.commit()
    return threads.thread_dict(s, t)


# ---- wave D: companies, notes, contacts, follows, news and adverse media ----
SLUG = r"^[a-z0-9]+(-[a-z0-9]+)*$"
PERIOD_RX = r"^\d{4}-(0[1-9]|1[0-2])$"
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3)]


def _profiles_on(s: Session) -> bool:
    return people.get_setting(s, "company_profiles_partner_enabled") is True


def company_caller(c: Caller = Depends(caller), s: Session = Depends(get_db)) -> Caller:
    """Every /companies* route: a partner role reaches them only while company_profiles_partner_enabled is true; otherwise
    404 not_found, as for anything it cannot see. TAO roles always."""
    if not c.is_tao and not _profiles_on(s):
        raise err(404, "not_found", "not found")
    return c


def company_admin_caller(c: Caller = Depends(company_caller)) -> Caller:
    return admin_only(c)


def company_tao_caller(c: Caller = Depends(company_caller)) -> Caller:
    """Notes: TAO only. A partner (with company profiles on) gets 403 tao_only; notes never reach a partner route."""
    return tao_only(c)


def company_tao_user_caller(c: Caller = Depends(company_tao_caller)) -> Caller:
    return user_required(c)


def company_user_caller(c: Caller = Depends(company_caller)) -> Caller:
    return user_required(c)


def visible_deals(s: Session, partner: str | None) -> list[Deal]:
    """The deals of the programs visible_programs gives the caller (every deal for TAO). The only partner scoping the
    company routes do: everything below is built from this list."""
    q = select(Deal).order_by(Deal.slug)
    if partner is not None:
        q = q.where(Deal.program_slug.in_([p.slug for p in visible_programs(s, partner)]))
    return list(s.scalars(q).all())


def _company_view(s: Session, partner: str | None, slug: str) -> tuple[Company | None, list[Deal], Deal | None]:
    """(company, its visible deals, None), or (None, [deal], deal) for a deal on no company read as its own company (its slug
    is the deal's). A partner with no visible deal in the company gets 404, exactly as a missing company."""
    deals = visible_deals(s, partner)
    co = s.get(Company, slug)
    if co is not None:
        mine = [d for d in deals if d.company_slug == slug]
        if partner is not None and not mine:
            raise err(404, "not_found", f"no company {slug}")
        return co, mine, None
    d = next((d for d in deals if d.slug == slug and d.company_slug is None), None)
    if d is None:
        raise err(404, "not_found", f"no company {slug}")
    return None, [d], d


def _real_company(s: Session, partner: str | None, slug: str) -> tuple[Company, list[Deal]]:
    co, deals, _ = _company_view(s, partner, slug)
    if co is None:
        raise err(404, "not_found", f"{slug} is a deal on no company; create a company for it first")
    return co, deals


def _company_out(s: Session, c: Caller, partner: str | None, slug: str) -> dict:
    co, deals, fallback = _company_view(s, partner, slug)
    return companies.company_dict(s, co, deals, c.is_tao, c.user_id, fallback)


def _deal_links(s: Session, slug: str) -> list[str]:
    return list(s.scalars(select(Deal.slug).where(Deal.company_slug == slug).order_by(Deal.slug)).all())


def _check_deals(s: Session, slugs: list[str]) -> list[Deal]:
    out = []
    for x in dict.fromkeys(slugs):
        d = s.get(Deal, x)
        if d is None:
            raise err(422, "unknown_deal", f"no deal {x}")
        out.append(d)
    return out


def _company_change(s: Session, c: Caller, slug: str, change: str, before, after, reason: str | None, contact_id: str | None = None):
    """detail {company_slug, company_name, change, contact_id, before, after} (the Lead's shape for the audit page). change:
    created | record | deals | contact_added | contact_edited | contact_removed; before / after hold the changed fields only
    (deal links as {"deal_slugs": [...]}, a contact as the contact object)."""
    co = s.get(Company, slug)
    views.audit(s, c, "company_change", reason=reason, detail={"company_slug": slug, "company_name": co.name if co else slug, "change": change,
                                                               "contact_id": contact_id, "before": before, "after": after})


def _relink(s: Session, c: Caller, co: Company, deals: list[Deal], reason: str, only_add: bool = False) -> None:
    """Make `deals` the company's deal list (only_add: add them, keep the rest). Writes a `deals` entry for this company and
    for every other company a deal was moved away from."""
    touched = {co.slug} | {d.company_slug for d in deals if d.company_slug}
    before = {slug: _deal_links(s, slug) for slug in touched}
    keep = {d.slug for d in deals}
    if not only_add:
        for d in s.scalars(select(Deal).where(Deal.company_slug == co.slug)).all():
            if d.slug not in keep:
                d.company_slug = None
    for d in deals:
        d.company_slug = co.slug
    s.flush()
    for slug in sorted(touched, key=lambda x: x != co.slug):
        after = _deal_links(s, slug)
        if after != before[slug]:
            if slug != co.slug:
                s.get(Company, slug).updated_at = utcnow()
            _company_change(s, c, slug, "deals", {"deal_slugs": before[slug]}, {"deal_slugs": after}, reason)


def _aliases(xs) -> list[str]:
    return list(dict.fromkeys(a.strip() for a in (xs or []) if isinstance(a, str) and a.strip()))


class CompanyCreateIn(BaseModel):
    slug: Annotated[str, StringConstraints(pattern=SLUG)]
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    aliases: list[str] = Field(default_factory=list)
    deal_slugs: list[str]
    reason: Short


class CompanyPatchIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] | None = None
    aliases: list[str] | None = None
    industry: str | None = None
    naics: str | None = None
    headquarters: str | None = None
    website: str | None = None
    relationship_since: Annotated[str, StringConstraints(pattern=PERIOD_RX)] | None = None
    owner_user_id: str | None = None
    deal_slugs: list[str] | None = None
    news_search: dict | None = None                       # CompanyNewsSearch, checked in companies.check_news_search
    reason: Short


class ContactIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    role: str | None = None
    email: str | None = None
    receives: str | None = None
    reason: Short


class NoteIn(BaseModel):
    body: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    mentions: list[str] = Field(default_factory=list)
    collection_period: Annotated[str, StringConstraints(pattern=PERIOD_RX)] | None = None


class AdverseDecisionIn(BaseModel):
    note: Short


@app.get(API + "/companies")
def list_companies(following: bool | None = None, c: Caller = Depends(company_caller), partner: str | None = Depends(partner_filter),
                   s: Session = Depends(get_db)):
    """One row per company over the deals the caller may see (TAO: every company, also one with no deal yet), plus one row
    per visible deal on no company, named after the deal (its slug is the deal's)."""
    deals = visible_deals(s, partner)
    by: dict[str, list[Deal]] = {}
    for d in deals:
        if d.company_slug:
            by.setdefault(d.company_slug, []).append(d)
    rows = []
    for co in s.scalars(select(Company)).all():
        if partner is not None and co.slug not in by:
            continue
        rows.append(companies.row(s, co.slug, co.name, co, by.get(co.slug, []), c.is_tao, c.user_id))
    for d in deals:
        if d.company_slug is None and s.get(Company, d.slug) is None:
            rows.append(companies.row(s, d.slug, d.name, None, [d], c.is_tao, c.user_id))
    if following is not None:
        rows = [r for r in rows if r["following"] == following]
    return sorted(rows, key=lambda r: (r["name"].lower(), r["slug"]))


@app.post(API + "/companies", status_code=201)
def create_company(body: CompanyCreateIn, c: Caller = Depends(company_admin_caller), partner: str | None = Depends(partner_filter),
                   s: Session = Depends(get_db)):
    if s.get(Company, body.slug) is not None:
        raise err(409, "slug_taken", f"a company {body.slug} already exists")
    deals = _check_deals(s, body.deal_slugs)
    now = utcnow()
    co = Company(slug=body.slug, name=body.name, aliases=_aliases(body.aliases), created_at=now, updated_at=now)
    s.add(co)
    try:
        s.flush()
    except IntegrityError:
        s.rollback()
        raise err(409, "slug_taken", f"a company {body.slug} already exists")
    _company_change(s, c, co.slug, "created", None, companies.record(co, []), body.reason)
    if deals:
        _relink(s, c, co, deals, body.reason, only_add=True)
    s.commit()
    return _company_out(s, c, partner, co.slug)


@app.get(API + "/companies/{company_slug}")
def get_company(company_slug: str, c: Caller = Depends(company_caller), partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
    return _company_out(s, c, partner, company_slug)


@app.patch(API + "/companies/{company_slug}")
def patch_company(company_slug: str, body: CompanyPatchIn, c: Caller = Depends(company_admin_caller), partner: str | None = Depends(partner_filter),
                  s: Session = Depends(get_db)):
    """Only the fields sent change. deal_slugs is the full list: a deal taken away is left on no company."""
    co, _ = _real_company(s, partner, company_slug)
    fields = body.model_dump(exclude_unset=True, exclude={"reason"})
    if not fields:
        raise err(422, "invalid", "send at least one field to change")
    for k in ("name", "aliases", "deal_slugs", "news_search"):
        if k in fields and fields[k] is None:
            raise err(422, "invalid", f"{k} cannot be null")
    search = None
    if "news_search" in fields:
        try:
            search = companies.check_news_search(companies.news_search(co), fields.pop("news_search"))
        except people.Refused as e:
            raise _refused(e)
    if fields.get("owner_user_id") is not None:
        u = s.get(AppUser, fields["owner_user_id"].lower()) if _is_uuid(fields["owner_user_id"]) else None
        if u is None or u.status != "active" or u.role not in ("tao_admin", "tao_analyst"):
            raise err(422, "invalid", "owner_user_id must be an active TAO user")
        fields["owner_user_id"] = u.id
    deals = _check_deals(s, fields.pop("deal_slugs")) if "deal_slugs" in fields else None
    if "aliases" in fields:
        fields["aliases"] = _aliases(fields["aliases"])
    old = {**companies.record(co, []), "news_search": companies.news_search(co)}
    for k, v in fields.items():
        setattr(co, k, v)
    if search is not None:
        co.news_context_terms, co.news_exclusions, co.news_languages = search["context_terms"], search["exclusions"], search["languages"]
    s.flush()
    new = {**companies.record(co, []), "news_search": companies.news_search(co)}
    changed = [k for k in new if new[k] != old[k]]
    if changed:
        co.updated_at = utcnow()
        _company_change(s, c, co.slug, "record", {k: old[k] for k in changed}, {k: new[k] for k in changed}, body.reason)
    if deals is not None:
        links = _deal_links(s, co.slug)
        _relink(s, c, co, deals, body.reason)
        if _deal_links(s, co.slug) != links:
            co.updated_at = utcnow()
    s.commit()
    return _company_out(s, c, partner, co.slug)


@app.get(API + "/companies/{company_slug}/deals/{deal_slug}/insights")
def company_insights(company_slug: str, deal_slug: str, c: Caller = Depends(company_caller), partner: str | None = Depends(partner_filter),
                     s: Session = Depends(get_db)):
    _, deals, _ = _company_view(s, partner, company_slug)
    d = next((x for x in deals if x.slug == deal_slug), None)
    pub = companies.latest_pub(s, deal_slug) if d else None
    if pub is None:
        raise err(404, "not_found", f"no published deal {deal_slug} in {company_slug}")
    return companies.insights(s, d, pub)


@app.get(API + "/companies/{company_slug}/news")
def company_news(company_slug: str, days: int = Query(default=30, ge=1, le=365), sentiment: Literal["positive", "neutral", "negative"] | None = None,
                 include: Literal["excluded", "pending", "all"] | None = None,
                 c: Caller = Depends(company_caller), partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
    """Partners: kept stories only (include ignored). TAO: kept and unchecked, plus excluded / pending with include. Newest
    first by published_at, else source_date, else found_at; days filters on the same date."""
    co, _, _ = _company_view(s, partner, company_slug)
    if co is None:
        return []
    q = select(NewsItem).where(NewsItem.company_slug == co.slug, companies.news_visible(c.is_tao, include if c.is_tao else None),
                               companies.news_date() >= utcnow() - dt.timedelta(days=days))
    if sentiment:
        q = q.where(NewsItem.sentiment == sentiment)
    return [companies.news_dict(n, c.is_tao) for n in s.scalars(q.order_by(companies.news_date().desc(), NewsItem.id)).all()]


@app.get(API + "/companies/{company_slug}/adverse")
def company_adverse(company_slug: str, state: Literal["open", "reviewed", "dismissed"] | None = None, c: Caller = Depends(company_caller),
                    partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
    """TAO: every state. Partners: reviewed only (decision D6); open and dismissed never leave the TAO routes. Wave E: items
    whose story the check excluded or has not checked yet (pending) are hidden from everyone."""
    co, _, _ = _company_view(s, partner, company_slug)
    if co is None:
        return []
    q = select(AdverseItem).where(AdverseItem.company_slug == co.slug, companies.adverse_visible())
    if not c.is_tao:
        q = q.where(AdverseItem.state == "reviewed")
    if state:
        q = q.where(AdverseItem.state == state)
    return [companies.adverse_dict(s, a) for a in s.scalars(q.order_by(AdverseItem.found_at.desc(), AdverseItem.id)).all()]


def _adverse_decide(s: Session, c: Caller, adverse_id: str, to: str, note: str) -> dict:
    a = s.get(AdverseItem, adverse_id) if _is_uuid(adverse_id) else None
    if a is None:
        raise err(404, "not_found", "no such adverse media item")
    if a.state != "open":
        raise err(409, "bad_state", f"the item is already {a.state}")
    a.state, a.note, a.state_by, a.state_at = to, note, c.user_id, utcnow()
    s.flush()
    views.audit(s, c, "adverse_change", reason=note, detail={"company_slug": a.company_slug, "adverse_id": a.id, "category": a.category,
                                                             "title": a.title, "state": to, "note": note})
    s.commit()
    if to == "reviewed":                                  # following partners hear about it now, not at the next sweep
        notify.company_sweep(s)
        s.commit()
    return companies.adverse_dict(s, a)


@app.post(API + "/adverse/{adverse_id}/review")
def review_adverse(adverse_id: str, body: AdverseDecisionIn, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    return _adverse_decide(s, c, adverse_id, "reviewed", body.note)


@app.post(API + "/adverse/{adverse_id}/dismiss")
def dismiss_adverse(adverse_id: str, body: AdverseDecisionIn, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    return _adverse_decide(s, c, adverse_id, "dismissed", body.note)


# notes (TAO only; writes need a user)
def _note_or_404(s: Session, note_id: str) -> CompanyNote:
    n = s.get(CompanyNote, note_id.lower()) if _is_uuid(note_id) else None
    if n is None or n.removed_at is not None:
        raise err(404, "not_found", "no such note")
    return n


def _note_audit(n: CompanyNote) -> dict:
    return {"body": n.body, "mentions": list(n.mentions or []), "collection_period": n.collection_period}


@app.get(API + "/companies/{company_slug}/notes")
def list_company_notes(company_slug: str, c: Caller = Depends(company_tao_caller), s: Session = Depends(get_db)):
    co, _ = _real_company(s, None, company_slug)
    rows = s.scalars(select(CompanyNote).where(CompanyNote.company_slug == co.slug, CompanyNote.removed_at.is_(None))
                     .order_by(CompanyNote.created_at.desc(), CompanyNote.id)).all()
    return [companies.note_dict(s, n) for n in rows]


@app.post(API + "/companies/{company_slug}/notes", status_code=201)
def add_company_note(company_slug: str, body: NoteIn, c: Caller = Depends(company_tao_user_caller), s: Session = Depends(get_db)):
    co, _ = _real_company(s, None, company_slug)
    try:
        mentions = threads.check_mentions(s, body.mentions)
    except people.Refused as e:
        raise _refused(e)
    n = CompanyNote(id=new_id(), company_slug=co.slug, author_id=c.user_id, body=body.body, mentions=mentions,
                    collection_period=body.collection_period, created_at=utcnow())
    s.add(n); s.flush()
    views.audit(s, c, "company_note", detail={"company_slug": co.slug, "note_id": n.id, **_note_audit(n)})
    notify.company_note_mentions(s, n, s.get(AppUser, c.user_id), mentions)
    s.commit()
    return companies.note_dict(s, n)


@app.patch(API + "/company-notes/{note_id}")
def edit_company_note(note_id: str, body: NoteIn, c: Caller = Depends(tao_user_caller), s: Session = Depends(get_db)):
    """Author only (403 not_author). mentions and collection_period left out stay as they are; only newly added mentions notify."""
    n = _note_or_404(s, note_id)
    if n.author_id != c.user_id:
        raise err(403, "not_author", "only the author can edit a note")
    sent = body.model_fields_set
    try:
        mentions = threads.check_mentions(s, body.mentions) if "mentions" in sent else list(n.mentions or [])
    except people.Refused as e:
        raise _refused(e)
    before = _note_audit(n)
    added = [m for m in mentions if m not in before["mentions"]]
    n.body, n.mentions, n.edited_at = body.body, mentions, utcnow()
    if "collection_period" in sent:
        n.collection_period = body.collection_period
    s.flush()
    views.audit(s, c, "company_note_edit", detail={"company_slug": n.company_slug, "note_id": n.id, "change": "edited", "before": before,
                                                   "after": _note_audit(n)})
    notify.company_note_mentions(s, n, s.get(AppUser, c.user_id), added)
    s.commit()
    return companies.note_dict(s, n)


@app.delete(API + "/company-notes/{note_id}", status_code=204)
def remove_company_note(note_id: str, c: Caller = Depends(tao_user_caller), s: Session = Depends(get_db)):
    """The author or any TAO Admin. The row stays (removed_at); the company_note_edit entry keeps the text."""
    n = _note_or_404(s, note_id)
    if not (c.is_admin or n.author_id == c.user_id):
        raise err(403, "forbidden", "only the author or a TAO Admin can remove a note")
    n.removed_at = utcnow()
    views.audit(s, c, "company_note_edit", detail={"company_slug": n.company_slug, "note_id": n.id, "change": "removed",
                                                   "before": _note_audit(n), "after": None})
    s.commit()
    return Response(status_code=204)


# contacts (tao_admin; rows are kept on removal)
def _contact_or_404(s: Session, contact_id: str) -> CompanyContact:
    x = s.get(CompanyContact, contact_id.lower()) if _is_uuid(contact_id) else None
    if x is None or x.removed_at is not None:
        raise err(404, "not_found", "no such contact")
    return x


@app.post(API + "/companies/{company_slug}/contacts", status_code=201)
def add_contact(company_slug: str, body: ContactIn, c: Caller = Depends(company_admin_caller), s: Session = Depends(get_db)):
    co, _ = _real_company(s, None, company_slug)
    x = CompanyContact(id=new_id(), company_slug=co.slug, name=body.name, role=body.role, email=body.email, receives=body.receives, created_at=utcnow())
    s.add(x); s.flush()
    co.updated_at = utcnow()
    _company_change(s, c, co.slug, "contact_added", None, companies.contact_dict(x), body.reason, contact_id=x.id)
    s.commit()
    return companies.contact_dict(x)


@app.patch(API + "/company-contacts/{contact_id}")
def edit_contact(contact_id: str, body: ContactIn, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    """name is always sent; role, email and receives change only when sent (null clears)."""
    x = _contact_or_404(s, contact_id)
    before = companies.contact_dict(x)
    for k, v in body.model_dump(exclude_unset=True, exclude={"reason"}).items():
        setattr(x, k, v)
    s.flush()
    after = companies.contact_dict(x)
    if after != before:
        s.get(Company, x.company_slug).updated_at = utcnow()
        _company_change(s, c, x.company_slug, "contact_edited", before, after, body.reason, contact_id=x.id)
    s.commit()
    return after


@app.delete(API + "/company-contacts/{contact_id}", status_code=204)
def remove_contact(contact_id: str, reason: str = Query(min_length=3), c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    x = _contact_or_404(s, contact_id)
    if len(reason.strip()) < 3:
        raise err(422, "invalid", "reason needs at least 3 characters")
    x.removed_at = utcnow()
    s.get(Company, x.company_slug).updated_at = utcnow()
    _company_change(s, c, x.company_slug, "contact_removed", companies.contact_dict(x), None, reason.strip(), contact_id=x.id)
    s.commit()
    return Response(status_code=204)


# follows (any role that can see the company; needs a user)
@app.put(API + "/companies/{company_slug}/follow", status_code=204)
def follow_company(company_slug: str, c: Caller = Depends(company_user_caller), partner: str | None = Depends(partner_filter),
                   s: Session = Depends(get_db)):
    co, _ = _real_company(s, partner, company_slug)
    if s.get(CompanyFollow, (c.user_id, co.slug)) is None:
        s.add(CompanyFollow(user_id=c.user_id, company_slug=co.slug, created_at=utcnow()))
        try:
            s.commit()
        except IntegrityError:                            # a second click at the same moment: already following
            s.rollback()
    return Response(status_code=204)


@app.delete(API + "/companies/{company_slug}/follow", status_code=204)
def unfollow_company(company_slug: str, c: Caller = Depends(company_user_caller), partner: str | None = Depends(partner_filter),
                     s: Session = Depends(get_db)):
    co, _ = _real_company(s, partner, company_slug)
    f = s.get(CompanyFollow, (c.user_id, co.slug))
    if f is not None:
        s.delete(f)
        s.commit()
    return Response(status_code=204)


# news runs (TAO)
@app.get(API + "/news/runs")
def list_news_runs(limit: int = Query(default=10, ge=1, le=50), c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    return [companies.run_dict(r) for r in s.scalars(select(NewsRun).order_by(NewsRun.queued_at.desc(), NewsRun.id).limit(limit)).all()]


@app.post(API + "/news/runs", status_code=202)
def run_news_now(company_slug: str | None = Query(default=None), c: Caller = Depends(admin_caller), s: Session = Depends(get_db),
                 q=Depends(get_news_queue)):
    """Queues a manual run: a news_run row (trigger manual, status queued), its id LPUSHed to the news queue. If the queue
    cannot be reached the run is recorded as failed (errors say why) and still returned. With company_slug the run covers
    that company only (Run now on a company profile) and does not need the daily search to be on."""
    if company_slug is not None:
        if s.get(Company, company_slug) is None:
            raise err(404, "not_found", f"no company {company_slug}")
        return _queue_news_run(s, c, q, "manual", company_slug)
    if not (people.get_setting(s, "company_feeds") or {}).get("enabled"):
        raise err(409, "feeds_off", "company feeds are switched off (System settings, company_feeds.enabled)")
    return _queue_news_run(s, c, q, "manual")


def _queue_news_run(s: Session, c: Caller, q, trigger: str, company_slug: str | None = None) -> dict:
    """A news_run row (status queued), its id LPUSHed to the news queue, a news_run audit entry. 409 run_active while another
    run is queued or running."""
    active = s.scalars(select(NewsRun).where(NewsRun.status.in_(("queued", "running")))).first()
    if active is not None:
        raise err(409, "run_active", f"a news run is already {active.status} (queued {views.iso(active.queued_at)})")
    r = NewsRun(id=new_id(), trigger=trigger, status="queued", queued_at=utcnow(), companies=0, items_added=0, adverse_added=0, errors=[], stats={},
                company_slug=company_slug)
    s.add(r); s.flush()
    detail = {"run_id": r.id, "trigger": trigger}
    if company_slug is not None:
        co = s.get(Company, company_slug)
        detail.update(company_slug=company_slug, company_name=co.name if co else None)
    views.audit(s, c, "news_run", detail=detail)
    s.commit()
    try:
        q.push(r.id)
    except Exception as e:                                # queue down: say so on the run instead of leaving it queued forever
        log.error("news queue push failed for %s: %s", r.id, e)
        r.status, r.finished_at = "failed", utcnow()
        r.errors = [{"company_slug": None, "source": "api", "message": f"news queue unavailable: {str(e)[:200]}"}]
        s.commit()
    return companies.run_dict(r)


@app.post(API + "/news/recheck", status_code=202)
def recheck_news(c: Caller = Depends(admin_caller), s: Session = Depends(get_db), q=Depends(get_news_queue)):
    """Wave E (E9): re-check every stored story. A run with trigger recheck, queued like Run now; allowed while feeds are off."""
    return _queue_news_run(s, c, q, "recheck")


# ---- wave E: paid news sources (tao_admin). Secret values never leave the API: see app/news_sources.py ----
def _provider(provider: str) -> str:
    if provider not in news_sources.PROVIDERS:
        raise err(404, "not_found", f"no news source {provider}")
    return provider


@app.get(API + "/news/sources")
def list_news_sources(c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    out = news_sources.all_sources(s)
    s.commit()                                            # rows added for providers a create_all database lacks
    return out


@app.put(API + "/news/sources/{provider}")
async def put_news_source(provider: str, request: Request, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    """The body is read by hand, not by a pydantic model, so a validation error can never echo a credential back
    (the global 422 handler returns the offending input)."""
    _provider(provider)
    try:
        body = json.loads(await request.body() or b"null")
    except ValueError:
        raise err(422, "invalid", "the body is not JSON")
    try:
        upd = news_sources.check_update(provider, body)
        r = news_sources.row(s, provider)
        detail = news_sources.apply_update(s, r, upd, c.user_id)
    except people.Refused as e:
        s.rollback()
        raise _refused(e)
    if detail.pop("changed"):
        views.audit(s, c, "news_source_change", reason=upd["reason"], detail=detail)
    s.commit()
    return news_sources.source_dict(s, r)


@app.post(API + "/news/sources/{provider}/test", status_code=202)
def news_source_test(provider: str, c: Caller = Depends(admin_caller), s: Session = Depends(get_db), q=Depends(get_news_queue)):
    """Queues a connection test for the news worker: the JSON string {"type":"test","provider":...} on the news queue. If the
    queue cannot be reached the result is recorded on the source straight away."""
    r = news_sources.row(s, _provider(provider))
    try:
        news_sources.check_testable(r)
    except people.Refused as e:
        s.rollback()
        raise _refused(e)
    s.commit()
    try:
        q.push(news_sources.test_message(provider))
    except Exception as e:
        log.error("news queue push failed for a %s test: %s", provider, type(e).__name__)
        r.last_test_at, r.last_test_ok = utcnow(), False
        r.last_test_message = "News worker queue unavailable; try again shortly"
        s.commit()
    return news_sources.source_dict(s, r)
