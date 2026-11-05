"""Row -> contract-shaped dict, plus the small queries several routes share."""
import datetime as dt
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .models import (Partner, Program, ProgramPartner, Deal, CovenantDefinition, SetrepUpload, Extraction, Finding, ReviewAction, Publication,
                     PublicationVersion, Correction, ValueEdit)


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


def failure_reason(s: Session, u: SetrepUpload) -> str | None:
    """Why an upload is extraction_failed, read from the audit row that failed it. Both writers record the reason
    there: worker/validate mark_failed (actor 'system', action 'extract', reason = the error) and the API when the
    queue push fails (action 'extract', reason 'queue unavailable'). No column needed; None unless extraction_failed."""
    if u.status != "extraction_failed":
        return None
    return s.scalars(select(ReviewAction.reason).where(ReviewAction.upload_id == u.id, ReviewAction.action == "extract",
                                                       ReviewAction.reason.is_not(None))
                     .order_by(ReviewAction.at.desc())).first()


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
            "reject_reason": u.reject_reason, "failure_reason": failure_reason(s, u), "replaces_upload_id": u.replaces_upload_id,
            "replaced_by_upload_id": s.scalars(select(SetrepUpload.id).where(SetrepUpload.replaces_upload_id == u.id,
                                                                            SetrepUpload.status == "published")).first(),
            "active_edit_count": active_edit_count(s, u.id), "published_version": published_version(s, u, pub),
            "pending_correction_id": s.scalars(select(Correction.id).where(Correction.upload_id == u.id,
                                                                          Correction.status == "needs_review")).first()}


def active_edit_count(s: Session, upload_id: str) -> int:
    """Review edits in force: pointers whose latest not-reverted edit exists (a later edit on a pointer replaces the earlier)."""
    rows = s.scalars(select(ValueEdit.pointer).where(ValueEdit.upload_id == upload_id, ValueEdit.correction_id.is_(None),
                                                     ValueEdit.reverted_at.is_(None))).all()
    return len(set(rows))


def published_version(s: Session, u: SetrepUpload, pub: Publication | None) -> int | None:
    """The live version when this upload's publication is current; else the last version it held (a replaced upload)."""
    if pub is not None:
        return pub.version
    return s.scalar(select(func.max(PublicationVersion.version)).where(PublicationVersion.upload_id == u.id))


def value_edit_dict(e: ValueEdit) -> dict:
    return {"id": e.id, "upload_id": e.upload_id, "correction_id": e.correction_id, "pointer": e.pointer, "old_value": e.old_value,
            "new_value": e.new_value, "reason": e.reason, "source_page": e.source_page, "actor_role": e.actor_role,
            "actor_label": e.actor_label, "at": iso(e.at), "reverted_at": iso(e.reverted_at), "reverted_by": e.reverted_by,
            "revert_reason": e.revert_reason}


def correction_dict(s: Session, c: Correction, findings: bool = False) -> dict:
    u = s.get(SetrepUpload, c.upload_id)
    edits = s.scalars(select(ValueEdit).where(ValueEdit.correction_id == c.id).order_by(ValueEdit.at, ValueEdit.id)).all()
    out = {"id": c.id, "upload_id": c.upload_id, "deal_slug": u.deal_slug, "collection_period": u.collection_period, "status": c.status,
           "version": c.version, "edits": [value_edit_dict(e) for e in edits], "reason": c.reason, "note_to_partners": c.note_to_partners,
           "finding_counts": c.finding_counts or {"block": 0, "review": 0, "note": 0}, "created_at": iso(c.created_at),
           "created_by": c.created_by, "decided_at": iso(c.decided_at), "decided_by": c.decided_by, "reject_reason": c.reject_reason}
    if findings:
        out["findings"] = c.findings or []
    return out


def publication_versions(s: Session, pub: Publication) -> list[dict]:
    """Every version of a publication, oldest first; the live one has current = true."""
    old = s.scalars(select(PublicationVersion).where(PublicationVersion.publication_id == pub.id).order_by(PublicationVersion.version)).all()
    ids = {x for x in [pub.correction_id, *(v.correction_id for v in old)] if x}
    notes = dict(s.execute(select(Correction.id, Correction.note_to_partners).where(Correction.id.in_(ids))).all()) if ids else {}
    rows = [{"version": v.version, "published_at": iso(v.published_at), "published_by": v.published_by, "correction_id": v.correction_id,
             "reason": v.version_reason, "note_to_partners": notes.get(v.correction_id), "current": False} for v in old]
    return rows + [{"version": pub.version, "published_at": iso(pub.published_at), "published_by": pub.published_by,
                    "correction_id": pub.correction_id, "reason": pub.version_reason, "note_to_partners": notes.get(pub.correction_id),
                    "current": True}]


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
            "effective_from": c.effective_from.isoformat(), "source": c.source, "unit": c.unit, "origin": c.origin or "seed",
            "superseded_at": iso(c.superseded_at), "supersedes_id": c.supersedes_id, "changed_by": c.changed_by, "change_reason": c.change_reason,
            "changed_at": iso(c.changed_at)}


def audit_dict(a: ReviewAction) -> dict:
    return {"id": a.id, "at": iso(a.at), "actor_role": a.actor_role, "actor_label": a.actor_label, "action": a.action,
            "upload_id": a.upload_id, "finding_id": a.finding_id, "reason": a.reason, "detail": a.detail or {}}


def covenants_as_of(s: Session, deal_slug: str | None, as_of: dt.date | None, include_history: bool = False) -> list[CovenantDefinition]:
    """All current definitions, or, with as_of, the one in force for each (deal, legal_ref): latest effective_from <= as_of.
    Superseded rows (007 / 009, superseded_at set) are returned only with include_history, and then every row is returned
    (with as_of: every row with effective_from <= as_of), ordered by deal, legal_ref, effective_from."""
    q = select(CovenantDefinition)
    if not include_history:
        q = q.where(CovenantDefinition.superseded_at.is_(None))
    if deal_slug:
        q = q.where(CovenantDefinition.deal_slug == deal_slug)
    if as_of:
        q = q.where(CovenantDefinition.effective_from <= as_of)
    rows = s.scalars(q.order_by(CovenantDefinition.deal_slug, CovenantDefinition.legal_ref, CovenantDefinition.effective_from,
                                CovenantDefinition.superseded_at.is_(None), CovenantDefinition.superseded_at)).all()
    if not as_of or include_history:
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
