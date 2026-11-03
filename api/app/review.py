"""Finding overrides and the rule re-run. Rule logic stays in the `rules` package; this module only builds its
Context from the database, calls rules.run(), and merges the result into the stored findings.

Context handed to rules.run (agree changes with the Rules agent, see docs/requests.md):
    prior              last published deal object for this deal with a period before the upload's, or None
    master             {"program": Program, "deal": Deal, "covenants": [CovenantDefinition as of the period end]}
    published_periods  {collection_period, ...} already published for this deal
    upload             the Upload dict (deal_slug, program_slug, collection_period, ...)

Merge: a re-run finding is the "same" finding as a stored one when rule_id and fields match. Same -> keep the
stored id, status and resolution, refresh the values. Stored open finding not produced again -> closed.
New -> inserted open. So an override sticks across re-runs, and ids the UI holds stay valid."""
import calendar, datetime as dt, pathlib, sys
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import Program, Deal, Publication, Finding, Extraction, SetrepUpload, utcnow
from . import views

PHASES = (1, 2)
CHOICE_STATUS = {"use_ours": "overridden", "use_report": "overridden", "acknowledge": "overridden",
                 "restatement": "accepted_as_restatement"}
VALUE_KEYS = ("layer", "severity", "message", "our_value", "report_value", "difference", "tolerance", "unit", "source_page", "context")


def _rules():
    try:
        import rules
    except ImportError:                                   # local run from api/: rules lives at the repo root
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
        import rules
    from rules.engine import Context
    return rules, Context


def period_end(period: str) -> dt.date:
    y, m = map(int, period.split("-"))
    return dt.date(y, m, calendar.monthrange(y, m)[1])


def build_context(s: Session, u: SetrepUpload):
    _, Context = _rules()
    deal = s.get(Deal, u.deal_slug)
    program = s.get(Program, deal.program_slug)
    pubs = s.scalars(select(Publication).where(Publication.deal_slug == u.deal_slug).order_by(Publication.collection_period)).all()
    prior = next((p.deal for p in reversed(pubs) if p.collection_period < u.collection_period), None)
    master = {"program": views.program_dict(program), "deal": views.deal_dict(deal),
              "covenants": [views.covenant_dict(c) for c in views.covenants_as_of(s, u.deal_slug, period_end(u.collection_period))]}
    return Context(prior=prior, master=master, published_periods={p.collection_period for p in pubs},
                   upload=views.upload_dict(s, u))


def rerun(s: Session, u: SetrepUpload, ex: Extraction) -> list[Finding]:
    rules, _ = _rules()
    produced = rules.run({"meta": ex.meta, "deal": ex.deal, "sources": ex.sources}, build_context(s, u), phases=PHASES)
    stored = s.scalars(select(Finding).where(Finding.extraction_id == ex.id).order_by(Finding.created_at)).all()
    pool: dict[tuple, list[Finding]] = {}
    for f in stored:
        pool.setdefault((f.rule_id, tuple(f.fields or [])), []).append(f)
    seen = set()
    for nf in produced:
        bucket = pool.get((nf["rule_id"], tuple(nf.get("fields") or [])), [])
        match = next((f for f in bucket if f.id not in seen), None)
        if match is None:
            match = Finding(extraction_id=ex.id, rule_id=nf["rule_id"], fields=nf.get("fields") or [], status="open")
            s.add(match); s.flush()
        elif match.status == "closed":
            match.status, match.resolution = "open", None
        for k in VALUE_KEYS:
            setattr(match, k, nf.get(k))
        seen.add(match.id)
    for f in stored:
        if f.id not in seen and f.status == "open":
            f.status = "closed"
    s.flush()
    return s.scalars(select(Finding).where(Finding.extraction_id == ex.id).order_by(Finding.created_at)).all()


def resolve(f: Finding, choice: str, reason: str, by: str) -> None:
    f.status = CHOICE_STATUS[choice]
    f.resolution = {"by": by, "at": views.iso(utcnow()), "choice": choice, "reason": reason}
