"""Finding overrides and the rule re-run. Rule logic stays in the `rules` package; this module only builds its
Context from the database, calls rules.run(), and merges the result into the stored findings.

Context handed to rules.run (agree changes with the Rules agent, see docs/requests.md):
    prior              last published deal object for this deal with a period before the upload's, or None
    master             {"program": Program, "deal": Deal, "covenants": [CovenantDefinition as of the period end],
                        "covenants_recorded": count of the deal's current definitions at any effective date}
    published_periods  {collection_period: published_at (ISO)} already published for this deal (same keys as worker/validate)
    upload             the Upload dict (deal_slug, program_slug, collection_period, ...)

Merge: a re-run finding is the "same" finding as a stored one when rule_id and fields match. Same -> keep the
stored id, status and resolution, refresh the values. Stored open finding not produced again -> closed.
New -> inserted open. So an override sticks across re-runs, and ids the UI holds stay valid.

Value edits (wave B): a review edit (value_edit with no correction_id) is stored beside the extraction. Every re-run and the
approve read the extraction's deal with the edits in force applied (apply_edits). On a pointer the latest not-reverted edit
is in force. A manual edit wins over a use_ours / use_report on the same pointer (risk R3): apply_overrides skips that
pointer and reports it as replaced; the override and the edit both keep their audit entries."""
import calendar, copy, datetime as dt, pathlib, sys
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import Program, Deal, Publication, Finding, Extraction, SetrepUpload, ValueEdit, utcnow
from . import views

PHASES = (1, 2)
CHOICE_STATUS = {"use_ours": "overridden", "use_report": "overridden", "acknowledge": "overridden",
                 "restatement": "accepted_as_restatement"}
VALUE_CHOICES = ("use_ours", "use_report")
VALUE_KEYS = ("targets", "layer", "severity", "message", "our_value", "report_value", "difference", "tolerance", "unit", "source_page", "context")


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


def build_context(s: Session, u: SetrepUpload, correcting: bool = False):
    """correcting=True: the rule re-run of a post-publish correction. Its own period is then left out of published_periods,
    so R12 does not report the publication being corrected as a duplicate."""
    _, Context = _rules()
    deal = s.get(Deal, u.deal_slug)
    program = s.get(Program, deal.program_slug)
    pubs = s.scalars(select(Publication).where(Publication.deal_slug == u.deal_slug).order_by(Publication.collection_period)).all()
    prior = next((p.deal for p in reversed(pubs) if p.collection_period < u.collection_period), None)
    master = {"program": views.program_dict(s, program), "deal": views.deal_dict(deal),
              "covenants": [views.covenant_dict(c) for c in views.covenants_as_of(s, u.deal_slug, period_end(u.collection_period))],
              # current definitions at any effective date (parity with worker/validate): R14 tells "none recorded" (one
              # note) from "recorded but not in force yet" (one note per covenant, e.g. Stride before 2026-01-22)
              "covenants_recorded": len(views.covenants_as_of(s, u.deal_slug, None))}
    published = {p.collection_period: views.iso(p.published_at) for p in pubs
                 if not (correcting and p.collection_period == u.collection_period)}
    return Context(prior=prior, master=master, published_periods=published, upload=views.upload_dict(s, u))


def rerun(s: Session, u: SetrepUpload, ex: Extraction) -> list[Finding]:
    """Re-run the rules on the extraction with every review edit in force applied, and merge into the stored findings."""
    rules, _ = _rules()
    deal = apply_edits(ex.deal, active_edits(s, u.id))
    produced = rules.run({"meta": ex.meta, "deal": deal, "sources": ex.sources}, build_context(s, u), phases=PHASES)
    stored = s.scalars(select(Finding).where(Finding.extraction_id == ex.id).order_by(Finding.created_at)).all()
    pool: dict[tuple, list[Finding]] = {}
    for f in stored:
        pool.setdefault((f.rule_id, tuple(f.fields or [])), []).append(f)
    seen = set()
    for nf in produced:
        bucket = pool.get((nf["rule_id"], tuple(nf.get("fields") or [])), [])
        match = next((f for f in bucket if f.id not in seen), None)
        if match is None:
            match = Finding(extraction_id=ex.id, rule_id=nf["rule_id"], fields=nf.get("fields") or [], status="open",
                            **{k: nf.get(k) for k in VALUE_KEYS})              # values before the flush: layer etc. are not null
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


# ---- applying use_ours / use_report on approve ----
def _unescape(tok: str) -> str:
    return tok.replace("~1", "/").replace("~0", "~")


def _walk(doc, pointer: str):
    """(container, key) for an RFC 6901 pointer, or None when the path does not exist."""
    toks = [_unescape(t) for t in pointer.split("/")[1:]]
    if not toks:
        return None
    cur = doc
    for tok in toks[:-1]:
        if isinstance(cur, dict) and tok in cur:
            cur = cur[tok]
        elif isinstance(cur, list) and tok.isdigit() and int(tok) < len(cur):
            cur = cur[int(tok)]
        else:
            return None
    last = toks[-1]
    if isinstance(cur, dict) and last in cur:
        return cur, last
    if isinstance(cur, list) and last.isdigit() and int(last) < len(cur):
        return cur, int(last)
    return None


class CorrectionConflict(Exception):
    """Two resolved findings write different values to the same pointer."""
    def __init__(self, conflicts: list[dict]):
        super().__init__(f"{len(conflicts)} pointer(s) get different values")
        self.conflicts = conflicts


def apply_overrides(deal: dict, findings: list[Finding], period: str, manual: dict | None = None) -> tuple[dict, list[dict]]:
    """Copy of `deal` with each use_ours / use_report choice written to every pointer in the finding's targets, plus one
    deal.data_corrections entry per pointer whose value changed. Nothing else is re-derived here (approve re-runs the
    rules on the result). Values are written exactly as the finding holds them (our_value is already rounded).
    Two findings choosing the same value for a pointer write it once (the first finding is credited); different values
    raise CorrectionConflict. A pointer that does not resolve is left alone and reported with applied = False.
    A pointer in `manual` (review edits in force) is not written: the edit replaces the override there (risk R3), reported
    with applied = False and the edit's id."""
    out = copy.deepcopy(deal)
    manual = manual or {}
    plan: dict[str, tuple[object, Finding, str]] = {}
    conflicts, corrections, today = [], [], dt.date.today().isoformat()
    for f in findings:
        res = f.resolution or {}
        if f.status != "overridden" or res.get("choice") not in VALUE_CHOICES or not f.targets:
            continue
        value = f.our_value if res["choice"] == "use_ours" else f.report_value
        for ptr in f.targets:
            if ptr in manual:
                corrections.append({"pointer": ptr, "finding_id": f.id, "rule_id": f.rule_id, "choice": res["choice"], "applied": False,
                                    "why": "replaced by a manual edit", "edit_id": manual[ptr].id})
                continue
            if ptr in plan:
                if plan[ptr][0] != value:
                    conflicts.append({"pointer": ptr, "values": [plan[ptr][0], value], "finding_ids": [plan[ptr][1].id, f.id],
                                      "rule_ids": [plan[ptr][1].rule_id, f.rule_id]})
                continue
            plan[ptr] = (value, f, res["choice"])
    if conflicts:
        raise CorrectionConflict(conflicts)
    for ptr, (value, f, choice) in plan.items():
        loc = _walk(out, ptr)
        if loc is None:
            corrections.append({"pointer": ptr, "finding_id": f.id, "rule_id": f.rule_id, "applied": False, "why": "pointer not found"})
            continue
        box, key = loc
        old = box[key]
        if old == value:
            continue
        box[key] = value
        toks = [_unescape(t) for t in ptr.split("/")[1:]]
        corrections.append({"period": period, "record": toks[0], "field": "/".join(toks[1:]), "old_value": old, "new_value": value,
                            "applied": today, "reason": (f.resolution or {}).get("reason"), "rule_id": f.rule_id, "choice": choice,
                            "finding_id": f.id})
    applied = [c for c in corrections if c.get("applied") is not False]
    if applied:
        out["data_corrections"] = list(out.get("data_corrections") or []) + applied
    return out, corrections


def new_blocks_after_corrections(s: Session, u: SetrepUpload, ex: Extraction, corrected: dict, stored: list[Finding]) -> list[dict]:
    """Re-run the rules (phases 1, 2) on the corrected deal. A block finding is new unless a stored finding with the same
    rule_id and fields was already resolved by the reviewer (e.g. R05 after use_report re-fires by design)."""
    rules, _ = _rules()
    resolved = {(f.rule_id, tuple(f.fields or [])) for f in stored if f.status != "open"}
    produced = rules.run({"meta": ex.meta, "deal": corrected, "sources": ex.sources}, build_context(s, u), phases=PHASES)
    return [{"rule_id": f["rule_id"], "message": f["message"], "fields": f.get("fields") or [], "our_value": f.get("our_value"),
             "report_value": f.get("report_value")}
            for f in produced if f["severity"] == "block" and (f["rule_id"], tuple(f.get("fields") or [])) not in resolved]


# ---- value edits (wave B) ----
def is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def value_at(doc: dict, pointer: str):
    """(found, value) at an RFC 6901 pointer."""
    loc = _walk(doc, pointer) if isinstance(pointer, str) and pointer.startswith("/") else None
    return (False, None) if loc is None else (True, loc[0][loc[1]])


def typed(old, new: float):
    """Keep an integer field an integer (a contract count stays 1234, not 1234.0)."""
    return int(new) if isinstance(old, int) and not isinstance(old, bool) and float(new).is_integer() else new


def check_number_edit(doc: dict, pointer: str, value: float) -> str | None:
    """Why `value` cannot be written at `pointer` in `doc`, or None. Only numbers at an existing pointer (risk R9)."""
    found, old = value_at(doc, pointer)
    if not found:
        return f"{pointer} is not in the deal"
    if not is_number(old):
        return f"{pointer} is not a number (only numeric values can be edited)"
    if isinstance(old, int) and not float(value).is_integer():
        return f"{pointer} holds a whole number"
    if float(old) == float(value):
        return f"{pointer} already holds {old}"
    return None


def active_edits(s: Session, upload_id: str) -> dict:
    """Review edits in force, by pointer: the latest not-reverted edit on each pointer (correction edits excluded)."""
    rows = s.scalars(select(ValueEdit).where(ValueEdit.upload_id == upload_id, ValueEdit.correction_id.is_(None),
                                             ValueEdit.reverted_at.is_(None)).order_by(ValueEdit.at, ValueEdit.id)).all()
    out: dict[str, ValueEdit] = {}
    for e in rows:
        out[e.pointer] = e                                # ordered by time: the last one wins
    return out


def apply_edits(deal: dict, edits) -> dict:
    """Copy of `deal` with each edit's new_value written at its pointer. A pointer that no longer resolves (e.g. after a
    pass-2 extraction) is skipped; approve reports it."""
    edits = list(edits.values()) if isinstance(edits, dict) else list(edits)
    if not edits:
        return deal
    out = copy.deepcopy(deal)
    for e in edits:
        loc = _walk(out, e.pointer)
        if loc is not None:
            box, key = loc
            box[key] = typed(box[key], e.new_value)
    return out


def correction_entry(pointer: str, period: str, old, new, reason: str, **extra) -> dict:
    """One deal.data_corrections row for a manual change (choice `manual`)."""
    toks = [_unescape(t) for t in pointer.split("/")[1:]]
    return {"period": period, "record": toks[0], "field": "/".join(toks[1:]), "old_value": old, "new_value": new,
            "applied": dt.date.today().isoformat(), "reason": reason, "choice": "manual", **extra}


def manual_corrections(original: dict, published: dict, edits: dict, period: str) -> tuple[dict, list[dict]]:
    """Append one data_corrections row per edited pointer (old = the extracted value, new = the value published) to `published`."""
    rows = []
    for ptr, e in edits.items():
        found, old = value_at(original, ptr)
        found_new, new = value_at(published, ptr)
        if not found or not found_new:
            rows.append({"pointer": ptr, "edit_id": e.id, "applied": False, "why": "pointer not found"})
            continue
        if old == new:
            continue
        rows.append(correction_entry(ptr, period, old, new, e.reason, edit_id=e.id, by=e.actor_role))
    applied = [r for r in rows if r.get("applied") is not False]
    if applied:
        published = dict(published)
        published["data_corrections"] = list(published.get("data_corrections") or []) + applied
    return published, rows


def finding_counts(findings) -> dict:
    counts = {"block": 0, "review": 0, "note": 0}
    for f in findings:
        st = f.status if isinstance(f, Finding) else f.get("status")
        sev = f.severity if isinstance(f, Finding) else f.get("severity")
        if st == "open" and sev in counts:
            counts[sev] += 1
    return counts


# ---- corrections after publish (wave B) ----
def correction_findings(s: Session, u: SetrepUpload, deal: dict) -> list[dict]:
    """Run the rules on a corrected published deal (prior = the published previous month). A produced finding is `open`
    unless the reviewer already resolved the same finding (rule_id + fields) when the report was approved: it then carries
    that status and resolution, so a block overridden in review (e.g. R05 use_report) does not hold up every correction."""
    rules, _ = _rules()
    ex = views.latest_extraction(s, u.id)
    resolved = {}
    if ex is not None:
        for f in s.scalars(select(Finding).where(Finding.extraction_id == ex.id)).all():
            if f.status not in ("open", "closed"):
                resolved[(f.rule_id, tuple(f.fields or []))] = f
    produced = rules.run({"meta": (ex.meta if ex else {}) or {}, "deal": deal, "sources": (ex.sources if ex else {}) or {}},
                         build_context(s, u, correcting=True), phases=PHASES)
    out = []
    for f in produced:
        f = {k: v for k, v in f.items() if k != "created_at"}
        f["extraction_id"] = ex.id if ex else None
        prev = resolved.get((f["rule_id"], tuple(f.get("fields") or [])))
        f["status"], f["resolution"] = (prev.status, prev.resolution) if prev else ("open", None)
        out.append(f)
    return out
