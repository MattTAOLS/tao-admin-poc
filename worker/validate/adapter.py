"""Builds the rules Context from the database, runs rules.run(), returns findings for the worker / API to persist.

All SQL lives here; rules/ stays free of DB and HTTP. Tables are the ones in db/migrations/001_init.sql.
The store takes a SQLAlchemy Connection (postgresql+psycopg in compose; SQLite in the tests), and only uses
portable SQL, so JSON / numeric / date columns are normalised in Python.

Typical worker flow for one upload:
    store = SqlStore(conn)
    findings = validate_extraction(store, extraction_id)          # pass 1
    pages = retry_pages(findings)                                  # block findings whose rule says retry_pass_2
    ... pass 2 on `pages` -> new extraction_id ...
    findings2 = validate_extraction(store, extraction_id_2)
    cleared = resolved_by_pass_2(findings, findings2)              # pass-1 findings pass 2 fixed
    insert_findings(conn, findings2 + cleared)
"""
from __future__ import annotations
import datetime as dt, decimal, json, uuid
from sqlalchemy import text
from rules import run, load_rules
from rules.engine import Context
from rules.checks import period_key

def _plain(v):
    if isinstance(v, decimal.Decimal): return float(v)
    if isinstance(v, (dt.datetime, dt.date)): return v.isoformat()
    if isinstance(v, uuid.UUID): return str(v)
    return v

def _json(v):
    return json.loads(v) if isinstance(v, (str, bytes)) else v

def _row(r, json_cols=()):
    if r is None: return None
    d = {k: _plain(v) for k, v in r._mapping.items()}
    for c in json_cols:
        if c in d: d[c] = _json(d[c])
    return d

class SqlStore:
    """Read-only queries the adapter needs, plus insert_findings for the worker."""
    def __init__(self, conn): self.conn = conn
    def _one(self, sql, json_cols=(), **kw): return _row(self.conn.execute(text(sql), kw).first(), json_cols)
    def _all(self, sql, json_cols=(), **kw): return [_row(r, json_cols) for r in self.conn.execute(text(sql), kw)]

    def extraction(self, extraction_id):
        return self._one("select id, upload_id, pass, meta, deal, sources from extraction where id = :id", ("meta", "deal", "sources"), id=str(extraction_id))
    def upload(self, upload_id):
        return self._one("select id, deal_slug, collection_period, reporting_period, file_name, page_count, uploaded_by, status from setrep_upload where id = :id", id=str(upload_id))
    def deal(self, slug):
        return self._one("select slug, name, program_slug, servicer, template_id from deal where slug = :slug", slug=slug)
    def program(self, slug):
        return self._one('select slug, name, partner_slug, currency, "limit", warehouse_limit from program where slug = :slug', slug=slug)
    def covenant_definitions(self, deal_slug):
        return self._all("select legal_ref, description, kind, threshold, threshold_rule, watch_buffer_pct, effective_from, source from covenant_definition where deal_slug = :slug",
                         ("threshold_rule",), slug=deal_slug)
    def publications(self, deal_slug):
        return self._all("select collection_period, published_at, deal from publication where deal_slug = :slug order by collection_period", ("deal",), slug=deal_slug)

def build_context(store, upload: dict, deal_obj: dict) -> Context:
    """prior = the latest publication for this deal before the upload's period; master = program, deal and covenant
    definitions (rules.checks picks the definition effective for the period); published_periods = every period
    already published with its timestamp; upload = what the analyst selected."""
    slug = upload["deal_slug"]
    period = period_key(upload.get("collection_period")) or period_key(deal_obj.get("collection_period"))
    deal_row = store.deal(slug) or {"slug": slug}
    program = store.program(deal_row["program_slug"]) if deal_row.get("program_slug") else None
    pubs = store.publications(slug)
    earlier = [p for p in pubs if period and period_key(p["collection_period"]) and period_key(p["collection_period"]) < period]
    prior = earlier[-1]["deal"] if earlier else None
    master = {"program": program or {}, "deal": deal_row, "covenant_definitions": store.covenant_definitions(slug)}
    return Context(prior=prior, master=master, published_periods={period_key(p["collection_period"]): p["published_at"] for p in pubs},
                   upload={"deal_slug": slug, "deal_name": deal_row.get("name"), "collection_period": upload.get("collection_period"),
                           "reporting_period": upload.get("reporting_period"), "upload_id": upload.get("id")})

def validate_extraction(store, extraction_id, phases=(1, 2), rules_doc: dict | None = None) -> list[dict]:
    """Run the rules over one stored extraction. Findings carry this extraction's id and are not yet persisted."""
    ex = store.extraction(extraction_id)
    if ex is None: raise LookupError(f"extraction {extraction_id} not found")
    upload = store.upload(ex["upload_id"])
    if upload is None: raise LookupError(f"upload {ex['upload_id']} not found")
    meta = dict(ex["meta"])
    if not meta.get("reporting_period") and upload.get("reporting_period"): meta["reporting_period"] = upload["reporting_period"]
    findings = run({"meta": meta, "deal": ex["deal"], "sources": ex.get("sources") or {}}, build_context(store, upload, ex["deal"]), phases=phases, rules_doc=rules_doc)
    for f in findings: f["extraction_id"] = str(ex["id"])
    return findings

def retry_pages(findings: list[dict], rules_doc: dict | None = None) -> list[int]:
    """Pages for the one automatic pass 2: source pages of open block findings whose rule says retry_pass_2_then_review."""
    retry = {r["id"] for r in (rules_doc or load_rules())["rules"] if r.get("on_failure") == "retry_pass_2_then_review"}
    return sorted({f["source_page"] for f in findings if f["severity"] == "block" and f["rule_id"] in retry and f.get("source_page")})

def _key(f): return (f["rule_id"], tuple(f.get("fields") or []), f.get("context", {}).get("vintage"), f.get("context", {}).get("legal_ref"))

def resolved_by_pass_2(pass1: list[dict], pass2: list[dict]) -> list[dict]:
    """Pass-1 findings with no counterpart in pass 2, marked resolved_by_pass_2 (kept for the audit trail)."""
    still = {_key(f) for f in pass2}
    return [{**f, "status": "resolved_by_pass_2"} for f in pass1 if _key(f) not in still]

def counts(findings: list[dict]) -> dict:
    """finding_counts for the upload summary: open findings by severity."""
    out = {"block": 0, "review": 0, "note": 0}
    for f in findings:
        if f.get("status", "open") == "open": out[f["severity"]] += 1
    return out

FINDING_COLUMNS = ("id", "extraction_id", "rule_id", "layer", "severity", "message", "fields", "our_value", "report_value", "difference", "tolerance", "unit", "source_page", "context", "status", "resolution", "created_at")
_JSON_COLUMNS = {"fields", "our_value", "report_value", "context", "resolution"}

def insert_findings(conn, findings: list[dict]) -> int:
    """Insert findings into the finding table (JSON columns serialised; Postgres casts text to jsonb on insert)."""
    if not findings: return 0
    cols = ", ".join(FINDING_COLUMNS); params = ", ".join(f":{c}" for c in FINDING_COLUMNS)
    rows = [{c: (json.dumps(f.get(c)) if c in _JSON_COLUMNS and f.get(c) is not None else f.get(c)) for c in FINDING_COLUMNS} for f in findings]
    conn.execute(text(f"insert into finding ({cols}) values ({params})"), rows)
    return len(rows)
