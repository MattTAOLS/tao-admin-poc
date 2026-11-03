"""TAO Admin POC API. Every route in contracts/openapi.yaml, backed by the database.
Role gates: `caller` resolves the role; intake routes call tao_only / admin_only first, before touching data.
Partner tenancy: every /published/* route takes `partner_filter` as a dependency and asks `visible_programs`
which programs it may read. Those two functions are the only place partner scoping happens."""
import datetime as dt, io, json, re, logging
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request, Query
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import Literal
from .auth import caller, tao_only, admin_only, Caller
from .db import get_db, file_store
from .jobs import get_queue
from .models import Partner, Program, Deal, CovenantDefinition, SetrepUpload, Extraction, Finding, ReviewAction, Publication, new_id, utcnow
from . import views, review, rollup

log = logging.getLogger("api")
app = FastAPI(title="TAO Admin POC API", version="0.1.0", openapi_url="/api/v1/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
API = "/api/v1"
PERIOD = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
STATUSES = ("received", "extracting", "needs_review", "approved", "rejected", "published", "extraction_failed")
PAGE_DPI = 110


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
                        c: Caller = Depends(tao_caller), s: Session = Depends(get_db), q=Depends(get_queue)):
    tao_only(c)
    _check_period(collection_period, "collection_period")
    if s.get(Deal, deal_slug) is None:
        raise err(422, "unknown_deal", f"no deal {deal_slug}")
    if s.scalars(select(Publication).where(Publication.deal_slug == deal_slug, Publication.collection_period == collection_period)).first():
        raise err(409, "already_published", f"{deal_slug} {collection_period} is already published (R12); reject or regenerate instead")
    data = await file.read()
    try:
        import pypdfium2 as pdfium
        pages = len(pdfium.PdfDocument(data))
    except Exception:
        raise err(422, "not_a_pdf", "the file is not a readable PDF")
    u = SetrepUpload(id=new_id(), deal_slug=deal_slug, collection_period=collection_period, file_name=file.filename or "source.pdf",
                     file_path="", page_count=pages, uploaded_by=c.role, status="received")
    path = _upload_dir(u.id) / "source.pdf"
    u.file_path = str(path)
    s.add(u)
    try:
        s.flush()
    except IntegrityError:
        s.rollback()
        raise err(409, "upload_in_progress", f"an upload for {deal_slug} {collection_period} is already in progress")
    views.audit(s, c, "upload", upload_id=u.id, detail={"file_name": u.file_name, "page_count": pages, "collection_period": collection_period})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    s.commit()
    try:
        q.push({"upload_id": u.id, "pass": 1})
    except Exception as e:                                   # queue down: say so on the upload, don't lose it silently
        log.error("queue push failed for %s: %s", u.id, e)
        u.status = "extraction_failed"
        views.audit(s, c, "extract", upload_id=u.id, reason="queue unavailable", detail={"error": str(e)[:200]})
        s.commit()
    return views.upload_dict(s, u)


@app.get(API + "/uploads")
def list_uploads(status: str | None = None, deal_slug: str | None = None, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    if status is not None and status not in STATUSES:
        raise err(422, "invalid", f"status must be one of {', '.join(STATUSES)}")
    qry = select(SetrepUpload)
    if status: qry = qry.where(SetrepUpload.status == status)
    if deal_slug: qry = qry.where(SetrepUpload.deal_slug == deal_slug)
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
    q.push({"upload_id": u.id, "pass": 2, "pages": pages})
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
    blocks = s.scalars(select(Finding).where(Finding.extraction_id == ex.id, Finding.severity == "block", Finding.status == "open")).all()
    if blocks:
        raise err(409, "open_block_findings", f"{len(blocks)} block finding(s) still open: {', '.join(sorted({b.rule_id for b in blocks}))}")
    overrides = [f.id for f in s.scalars(select(Finding).where(Finding.extraction_id == ex.id, Finding.resolution.is_not(None))).all()]
    u.status = "approved"
    views.audit(s, c, "approve", upload_id=u.id, detail={"extraction_id": ex.id, "pass": ex.pass_, "overrides_used": overrides})
    pub = s.scalars(select(Publication).where(Publication.deal_slug == u.deal_slug, Publication.collection_period == u.collection_period)).first()
    replaced = pub.upload_id if pub else None
    if pub is None:
        pub = Publication(upload_id=u.id, deal_slug=u.deal_slug, collection_period=u.collection_period, published_by=c.role, deal=ex.deal)
        s.add(pub)
    else:                                                     # R12 replace: same (deal, period), new upload
        pub.upload_id, pub.published_by, pub.published_at, pub.deal = u.id, c.role, utcnow(), ex.deal
        pub.rollup_version += 1
    u.status = "published"
    views.audit(s, c, "publish", upload_id=u.id, detail={"deal_slug": u.deal_slug, "collection_period": u.collection_period, "replaced_upload_id": replaced})
    program_slug = s.get(Deal, u.deal_slug).program_slug
    views.audit(s, c, "regenerate", upload_id=u.id, detail={"program_slug": program_slug, "trigger": "approve"})
    s.commit()
    return views.upload_dict(s, u)


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
def page_image(upload_id: str, n: int, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    u = get_upload_or_404(s, upload_id)
    if n < 1 or (u.page_count and n > u.page_count):
        raise err(404, "not_found", f"page {n} is outside 1..{u.page_count}")
    src = _upload_dir(u.id) / "source.pdf"
    if not src.exists():
        raise err(404, "not_found", "the source PDF is not in the file store")
    png = _upload_dir(u.id) / "pages" / f"{n}.png"
    if not png.exists():
        import pypdfium2 as pdfium
        png.parent.mkdir(parents=True, exist_ok=True)
        doc = pdfium.PdfDocument(str(src))
        try:
            doc[n - 1].render(scale=PAGE_DPI / 72).to_pil().save(png, format="PNG")
        finally:
            doc.close()
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
    partner_slug: str
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
    id: str | None = Field(default=None, description="omit to add a new definition (a new version when effective_from differs)")
    deal_slug: str
    legal_ref: str
    description: str
    kind: Literal["ceiling", "floor"]
    threshold: float | None = None
    threshold_rule: ThresholdRule | None = None
    watch_buffer_pct: float = 0.1
    effective_from: dt.date
    source: str | None = None


def _master_change(s, c, entity, key, before, after):
    views.audit(s, c, "master_change", detail={"entity": entity, "key": key, "before": before, "after": after})


@app.get(API + "/master/programs")
def programs(c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    return [views.program_dict(p) for p in s.scalars(select(Program).order_by(Program.slug)).all()]


@app.put(API + "/master/programs")
def put_program(body: ProgramIn, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    if s.get(Partner, body.partner_slug) is None:
        raise err(422, "unknown_partner", f"no partner {body.partner_slug}")
    p = s.get(Program, body.slug)
    before = views.program_dict(p) if p else None
    if p is None:
        p = Program(slug=body.slug); s.add(p)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    s.flush()
    _master_change(s, c, "program", body.slug, before, views.program_dict(p))
    s.commit()
    return views.program_dict(p)


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
def covenants(deal_slug: str | None = None, as_of: dt.date | None = None, c: Caller = Depends(tao_caller), s: Session = Depends(get_db)):
    tao_only(c)
    return [views.covenant_dict(r) for r in views.covenants_as_of(s, deal_slug, as_of)]


@app.put(API + "/master/covenants")
def put_covenant(body: CovenantIn, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    if s.get(Deal, body.deal_slug) is None:
        raise err(422, "unknown_deal", f"no deal {body.deal_slug}")
    if body.threshold is None and body.threshold_rule is None:
        raise err(422, "invalid", "a covenant needs threshold or threshold_rule")
    if body.id is not None and not _is_uuid(body.id):
        raise err(422, "invalid", "id must be a uuid")
    row = s.get(CovenantDefinition, body.id) if body.id else None
    before = views.covenant_dict(row) if row else None
    if row is None:
        row = CovenantDefinition(id=body.id or new_id()); s.add(row)
    data = body.model_dump(exclude={"id"})
    data["threshold_rule"] = body.threshold_rule.model_dump(exclude_none=True) if body.threshold_rule else None
    for k, v in data.items():
        setattr(row, k, v)
    s.flush()
    _master_change(s, c, "covenant_definition", row.id, before, views.covenant_dict(row))
    s.commit()
    return views.covenant_dict(row)


# ---- published views (all roles, partner-filtered) ----
def partner_filter(c: Caller = Depends(caller)) -> str | None:
    """TAO sees everything; a partner role sees only its own partner. ONE place, used by every published route."""
    return None if c.is_tao else c.partner


def visible_programs(s: Session, partner: str | None) -> list[Program]:
    q = select(Program).order_by(Program.slug)
    if partner is not None:
        q = q.where(Program.partner_slug == partner)
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
    period = period or max(p.collection_period for p in pubs)
    deals = [p.deal for p in pubs if p.collection_period == period]
    if not deals:
        return None
    agg = rollup.build_program(period, deals)
    periods = sorted({p.collection_period for p in pubs}, reverse=True)
    return {"program": views.program_dict(program), "available_periods": periods, **agg}


@app.get(API + "/published/portfolio")
def published_portfolio(partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
    out = []
    for p in visible_programs(s, partner):
        agg = _program_aggregate(s, p, None)
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
def published_deal(program_slug: str, deal_slug: str, period: str | None = None, partner: str | None = Depends(partner_filter), s: Session = Depends(get_db)):
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
    return {**pub.deal, "published_at": views.iso(pub.published_at), "published_by": pub.published_by, "upload_id": pub.upload_id,
            "published_period": pub.collection_period, "available_periods": periods}


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


@app.get(API + "/audit")
def audit(upload_id: str | None = None, c: Caller = Depends(admin_caller), s: Session = Depends(get_db)):
    admin_only(c)
    q = select(ReviewAction)
    if upload_id:
        if not _is_uuid(upload_id):
            raise err(422, "invalid", "upload_id must be a uuid")
        q = q.where(ReviewAction.upload_id == upload_id)
    return [views.audit_dict(a) for a in s.scalars(q.order_by(ReviewAction.at.desc())).all()]
