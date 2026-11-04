"""Row -> contract-shaped dict, plus the small queries several routes share."""
import datetime as dt
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .models import Partner, Program, ProgramPartner, Deal, CovenantDefinition, SetrepUpload, Extraction, Finding, ReviewAction, Publication


def iso(t: dt.datetime | None) -> str | None:
    if t is None:
        return None
    if t.tzinfo is None:                       # SQLite drops the zone; everything is stored in UTC
        t = t.replace(tzinfo=dt.timezone.utc)
    return t.isoformat()


def latest_extraction(s: Session, upload_id: str, pass_: int | None = None) -> Extraction | None:
    q = select(Extraction).where(Extraction.upload_id == upload_id)
    if pass_ is not None:
        q = q.where(Extraction.pass_ == pass_)
    return s.scalars(q.order_by(Extraction.pass_.desc(), Extraction.created_at.desc())).first()


def partner_slugs(s: Session, program: Program) -> list[str]:
    """Every partner who sees the program; program.partner_slug first (contract: partner_slug = the first one)."""
    rows = s.scalars(select(ProgramPartner.partner_slug).where(ProgramPartner.program_slug == program.slug)).all()
    first = [program.partner_slug] if program.partner_slug in rows or not rows else []
    return first + sorted(r for r in rows if r != program.partner_slug)


def set_partner_slugs(s: Session, program: Program, slugs: list[str]) -> None:
    """Make program_partner hold exactly `slugs`; program.partner_slug becomes slugs[0]."""
    program.partner_slug = slugs[0]
    have = set(s.scalars(select(ProgramPartner.partner_slug).where(ProgramPartner.program_slug == program.slug)).all())
    for gone in have - set(slugs):
        s.delete(s.get(ProgramPartner, (program.slug, gone)))
    for new in [x for x in slugs if x not in have]:
        s.add(ProgramPartner(program_slug=program.slug, partner_slug=new))
    s.flush()


def upload_dict(s: Session, u: SetrepUpload) -> dict:
    deal = s.get(Deal, u.deal_slug)
    program = s.get(Program, deal.program_slug) if deal else None
    ex = latest_extraction(s, u.id)
    counts = {"block": 0, "review": 0, "note": 0}
    if ex is not None:
        rows = s.execute(select(Finding.severity, func.count()).where(Finding.extraction_id == ex.id, Finding.status == "open")
                         .group_by(Finding.severity)).all()
        for sev, n in rows:
            counts[sev] = n
    pub = s.scalars(select(Publication).where(Publication.upload_id == u.id)).first()
    reporting = u.reporting_period or ((ex.meta or {}).get("reporting_period") if ex else None)
    return {"id": u.id, "deal_slug": u.deal_slug, "program_slug": deal.program_slug if deal else None,
            "partner_slug": program.partner_slug if program else None, "partner_slugs": partner_slugs(s, program) if program else [],
            "collection_period": u.collection_period,
            "reporting_period": reporting, "status": u.status, "file_name": u.file_name, "page_count": u.page_count,
            "uploaded_by": u.uploaded_by, "uploaded_at": iso(u.uploaded_at), "finding_counts": counts,
            "latest_extraction_id": ex.id if ex else None, "published_at": iso(pub.published_at) if pub else None,
            "reject_reason": u.reject_reason, "replaces_upload_id": u.replaces_upload_id,
            "replaced_by_upload_id": s.scalars(select(SetrepUpload.id).where(SetrepUpload.replaces_upload_id == u.id,
                                                                            SetrepUpload.status == "published")).first()}


def extraction_dict(e: Extraction) -> dict:
    return {"id": e.id, "upload_id": e.upload_id, "pass": e.pass_, "meta": e.meta, "deal": e.deal, "sources": e.sources,
            "confidence": e.confidence, "created_at": iso(e.created_at)}


FINDING_FIELDS = ("rule_id", "layer", "severity", "message", "fields", "targets", "our_value", "report_value", "difference", "tolerance",
                  "unit", "source_page", "context", "status", "resolution")


def finding_dict(f: Finding) -> dict:
    out = {"id": f.id, "extraction_id": f.extraction_id, **{k: getattr(f, k) for k in FINDING_FIELDS}, "created_at": iso(f.created_at)}
    out["fields"] = out["fields"] or []
    out["context"] = out["context"] or {}
    if not out["targets"]:
        out.pop("targets")                            # contract: present only when use_ours / use_report can change a value
    return out


def partner_dict(p: Partner) -> dict:
    return {"slug": p.slug, "name": p.name, "kind": p.kind, "status": p.status}


def program_dict(s: Session, p: Program) -> dict:
    return {"slug": p.slug, "name": p.name, "partner_slug": p.partner_slug, "partner_slugs": partner_slugs(s, p), "currency": p.currency, "limit": p.limit,
            "warehouse_limit": p.warehouse_limit}


def deal_dict(d: Deal) -> dict:
    return {"slug": d.slug, "name": d.name, "program_slug": d.program_slug, "servicer": d.servicer, "template_id": d.template_id}


def covenant_dict(c: CovenantDefinition) -> dict:
    return {"id": c.id, "deal_slug": c.deal_slug, "legal_ref": c.legal_ref, "description": c.description, "kind": c.kind,
            "threshold": c.threshold, "threshold_rule": c.threshold_rule, "watch_buffer_pct": c.watch_buffer_pct,
            "effective_from": c.effective_from.isoformat(), "source": c.source, "unit": c.unit}


def audit_dict(a: ReviewAction) -> dict:
    return {"id": a.id, "at": iso(a.at), "actor_role": a.actor_role, "actor_label": a.actor_label, "action": a.action,
            "upload_id": a.upload_id, "finding_id": a.finding_id, "reason": a.reason, "detail": a.detail or {}}


def covenants_as_of(s: Session, deal_slug: str | None, as_of: dt.date | None) -> list[CovenantDefinition]:
    """All definitions, or, with as_of, the one in force for each (deal, legal_ref): latest effective_from <= as_of."""
    q = select(CovenantDefinition)
    if deal_slug:
        q = q.where(CovenantDefinition.deal_slug == deal_slug)
    if as_of:
        q = q.where(CovenantDefinition.effective_from <= as_of)
    rows = s.scalars(q.order_by(CovenantDefinition.deal_slug, CovenantDefinition.legal_ref, CovenantDefinition.effective_from)).all()
    if not as_of:
        return list(rows)
    current: dict[tuple, CovenantDefinition] = {}
    for r in rows:
        current[(r.deal_slug, r.legal_ref)] = r          # ordered by effective_from, so the last one wins
    return list(current.values())


def audit(s: Session, c, action: str, upload_id=None, finding_id=None, reason=None, detail=None) -> ReviewAction:
    a = ReviewAction(upload_id=upload_id, finding_id=finding_id, actor_role=c.role, actor_label=getattr(c, "label", None) or c.role,
                     action=action, reason=reason, detail=detail or {})
    s.add(a)
    return a
