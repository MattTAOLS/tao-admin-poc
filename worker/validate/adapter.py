"""worker/validate: every database read and write the worker makes, and the rules run in between.

rules/ stays free of DB and HTTP; all SQL is here. Tables are db/migrations/001_init.sql (002 and 003 change only
setrep_upload's uniqueness and covenant_definition.threshold's width, neither of which this module depends on).
SQL is portable (PostgreSQL in compose, SQLite in the tests), so JSON / numeric / date columns are normalised in
Python. Importable as `validate` (the container runs `python main.py` from /app) and as `worker.validate` (repo root).

Worker entry points (worker/main.py calls these):
    mark_extracting(upload_id)                 received -> extracting when a job is taken
    handle_extraction(job, extraction)         store the extraction, run the rules, store findings (carrying the reviewer's
                                               resolutions over from the upload's previous extraction), set the status,
                                               queue the one automatic pass 2 when block findings ask for it
    mark_failed(upload_id, error)              -> extraction_failed, logged and audited
    recover_stale(queued_ids)                  uploads left in received / extracting with no job waiting -> extraction_failed
Each takes an optional SQLAlchemy Connection; without one it opens a transaction on DATABASE_URL and commits it.

Context parity: build_context returns the same shape as api/app/review.py build_context (the override re-run), and
both run phases (1, 2): prior = last published deal object before the upload's period; master = {program, deal,
covenants in force at the period end, covenants_recorded}; published_periods = set of published periods; upload = the API's Upload dict.
"""
from __future__ import annotations
import calendar, contextlib, copy, datetime as dt, decimal, json, logging, os, uuid
from sqlalchemy import create_engine, inspect, text
from rules import run, load_rules
from rules.engine import Context
from rules.checks import period_key

log = logging.getLogger("worker.validate")
PHASES = (1, 2)
QUEUE = "extract:jobs"   # same list as api/app/jobs.py

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

def _dump(v): return None if v is None else json.dumps(v)

def _ts(v) -> dt.datetime | None:
    """A database timestamp (datetime on PostgreSQL, 'YYYY-MM-DD HH:MM:SS' text on SQLite, ISO text after _plain) as an
    aware UTC datetime; None when it does not parse."""
    if v is None: return None
    if not isinstance(v, dt.datetime):
        try: v = dt.datetime.fromisoformat(str(v).strip().replace("Z", "+00:00"))
        except ValueError: return None
    return v if v.tzinfo else v.replace(tzinfo=dt.timezone.utc)

def period_end(period: str) -> dt.date:
    y, m = int(period[:4]), int(period[5:7])
    return dt.date(y, m, calendar.monthrange(y, m)[1])

# ---------- connection handling ----------
_ENGINE = None

def _engine():
    global _ENGINE
    if _ENGINE is None:
        url = os.environ.get("DATABASE_URL")
        if not url: raise RuntimeError("DATABASE_URL is not set and no connection was passed")
        _ENGINE = create_engine(url, pool_pre_ping=True)
    return _ENGINE

@contextlib.contextmanager
def _tx(conn=None):
    """Use the caller's connection (caller commits) or open and commit one transaction on DATABASE_URL."""
    if conn is not None:
        yield conn
    else:
        with _engine().begin() as c:
            yield c

def redis_enqueue(job: dict, url: str | None = None) -> None:
    """Default enqueue: RPUSH JSON onto `extract:jobs`, as api/app/jobs.py does."""
    import redis
    redis.Redis.from_url(url or os.environ.get("REDIS_URL", "redis://localhost:6379/0"), socket_connect_timeout=2).rpush(QUEUE, json.dumps(job))

# ---------- reads ----------
class SqlStore:
    def __init__(self, conn): self.conn = conn
    def _one(self, sql, json_cols=(), **kw): return _row(self.conn.execute(text(sql), kw).first(), json_cols)
    def _all(self, sql, json_cols=(), **kw): return [_row(r, json_cols) for r in self.conn.execute(text(sql), kw)]

    def extraction(self, extraction_id):
        return self._one("select id, upload_id, pass, meta, deal, sources, confidence, created_at from extraction where id = :id", ("meta", "deal", "sources"), id=str(extraction_id))
    def latest_extraction(self, upload_id, pass_=None):
        sql = "select id, upload_id, pass, meta, created_at from extraction where upload_id = :u" + (" and pass = :p" if pass_ else "") + " order by pass desc, created_at desc"
        return self._one(sql, ("meta",), u=str(upload_id), p=pass_)
    def _has_column(self, table, column):
        try: return column in {c["name"] for c in inspect(self.conn).get_columns(table)}
        except Exception: return False
    def upload(self, upload_id):
        # replaces_upload_id arrives with migration 006 (corrected re-issues); read it only when the column exists
        extra = ", replaces_upload_id" if self._has_column("setrep_upload", "replaces_upload_id") else ""
        return self._one(f"select id, deal_slug, collection_period, reporting_period, file_name, page_count, uploaded_by, uploaded_at, status, reject_reason{extra} from setrep_upload where id = :id", id=str(upload_id))
    def deal(self, slug):
        return self._one("select slug, name, program_slug, servicer, template_id from deal where slug = :slug", slug=slug)
    def program(self, slug):
        return self._one('select slug, name, partner_slug, currency, "limit", warehouse_limit from program where slug = :slug', slug=slug)
    def covenant_definitions(self, deal_slug):
        # superseded_at arrives with migration 007; superseded rows (the seed replaced them) are never in force
        current = " and superseded_at is null" if self._has_column("covenant_definition", "superseded_at") else ""
        return self._all("select id, deal_slug, legal_ref, description, kind, threshold, threshold_rule, watch_buffer_pct, effective_from, source from covenant_definition where deal_slug = :slug" + current,
                         ("threshold_rule",), slug=deal_slug)
    def _has_table(self, table):
        try: return inspect(self.conn).has_table(table)
        except Exception: return False
    def active_edits(self, upload_id):
        """Review edits in force, by pointer: the latest not-reverted edit on each pointer, correction edits excluded
        (api/app/review.active_edits). The value_edit table arrives with migration 009; without it there are none."""
        if not self._has_table("value_edit"): return {}
        out = {}
        for e in self._all("select id, pointer, new_value, at from value_edit where upload_id = :u and correction_id is null and reverted_at is null order by at, id", u=str(upload_id)):
            out[e["pointer"]] = e   # ordered by time: the last one wins
        return out
    def publications(self, deal_slug):
        return self._all("select upload_id, collection_period, published_at, deal from publication where deal_slug = :slug order by collection_period", ("deal",), slug=deal_slug)
    def previous_extraction(self, upload_id):
        """The upload's newest stored extraction, whatever its pass (call it before inserting the next one)."""
        return self._one("select id, upload_id, pass, meta, created_at from extraction where upload_id = :u order by created_at desc, pass desc", ("meta",), u=str(upload_id))
    def findings(self, extraction_id):
        targets = ", targets" if self._has_column("finding", "targets") else ""
        return self._all(f"select id, extraction_id, rule_id, severity, fields, our_value, report_value, difference, unit, context, status, resolution{targets} from finding where extraction_id = :e",
                         ("fields", "context", "our_value", "report_value", "resolution", "targets"), e=str(extraction_id))
    def stuck_uploads(self):
        """Uploads in received / extracting with the time anything last happened to them: the upload itself, its newest
        extraction, its newest audit row (the API audits a re-extract when it queues one)."""
        rows = self._all("select id, status, uploaded_at from setrep_upload where status in ('received', 'extracting')")
        for r in rows:
            ex = self.conn.execute(text("select max(created_at) from extraction where upload_id = :u"), {"u": str(r["id"])}).scalar()
            act = self.conn.execute(text("select max(at) from review_action where upload_id = :u"), {"u": str(r["id"])}).scalar()
            r["last_activity"] = max((t for t in (_ts(r.get("uploaded_at")), _ts(ex), _ts(act)) if t is not None), default=None)
        return rows
    def open_counts(self, extraction_id):
        out = {"block": 0, "review": 0, "note": 0}
        for r in self.conn.execute(text("select severity, count(*) as n from finding where extraction_id = :e and status = 'open' group by severity"), {"e": str(extraction_id)}):
            out[r.severity] = r.n
        return out

def covenants_as_of(defs: list[dict], as_of: dt.date | None) -> list[dict]:
    """The definition in force for each legal_ref: latest effective_from <= as_of (api/app/views.covenants_as_of)."""
    rows = sorted((d for d in defs if not as_of or str(d["effective_from"])[:10] <= as_of.isoformat()), key=lambda d: (d["legal_ref"], str(d["effective_from"])))
    current = {}
    for r in rows: current[(r["deal_slug"], r["legal_ref"])] = {**r, "effective_from": str(r["effective_from"])[:10]}
    return list(current.values())

def _walk(doc, pointer: str):
    """(container, key) for an RFC 6901 pointer, or None when the path does not exist (api/app/review._walk)."""
    toks = [t.replace("~1", "/").replace("~0", "~") for t in pointer.split("/")[1:]]
    if not toks: return None
    cur = doc
    for tok in toks[:-1]:
        if isinstance(cur, dict) and tok in cur: cur = cur[tok]
        elif isinstance(cur, list) and tok.isdigit() and int(tok) < len(cur): cur = cur[int(tok)]
        else: return None
    last = toks[-1]
    if isinstance(cur, dict) and last in cur: return cur, last
    if isinstance(cur, list) and last.isdigit() and int(last) < len(cur): return cur, int(last)
    return None

def _typed(old, new):
    """Keep an integer field an integer (api/app/review.typed)."""
    return int(new) if isinstance(old, int) and not isinstance(old, bool) and float(new).is_integer() else new

def apply_edits(deal: dict, edits) -> dict:
    """Copy of `deal` with each edit's new_value at its pointer (api/app/review.apply_edits). A pointer that no longer
    resolves in this extraction is skipped; the API's approve reports it."""
    edits = list(edits.values()) if isinstance(edits, dict) else list(edits or [])
    if not edits: return deal
    out = copy.deepcopy(deal)
    for e in edits:
        loc = _walk(out, e["pointer"])
        if loc is not None:
            box, key = loc; box[key] = _typed(box[key], e["new_value"])
    return out

def upload_dict(store: SqlStore, u: dict) -> dict:
    """Same keys as api/app/views.upload_dict."""
    deal = store.deal(u["deal_slug"]); program = store.program(deal["program_slug"]) if deal else None
    ex = store.latest_extraction(u["id"])
    pub = next((p for p in store.publications(u["deal_slug"]) if str(p.get("upload_id")) == str(u["id"])), None)
    return {"id": u["id"], "deal_slug": u["deal_slug"], "program_slug": deal["program_slug"] if deal else None,
            "partner_slug": program["partner_slug"] if program else None, "collection_period": u["collection_period"],
            "reporting_period": u.get("reporting_period") or ((ex or {}).get("meta") or {}).get("reporting_period"), "status": u["status"],
            "file_name": u.get("file_name"), "page_count": u.get("page_count"), "uploaded_by": u.get("uploaded_by"), "uploaded_at": u.get("uploaded_at"),
            "finding_counts": store.open_counts(ex["id"]) if ex else {"block": 0, "review": 0, "note": 0},
            "latest_extraction_id": ex["id"] if ex else None, "published_at": pub["published_at"] if pub else None, "reject_reason": u.get("reject_reason"),
            "replaces_upload_id": u.get("replaces_upload_id")}

def prior_publication(pubs: list[dict], period: str | None) -> dict | None:
    """The last publication with a period before `period` (pubs ordered by collection_period). Used by build_context
    for ctx.prior and by handle_extraction for history chaining, so both see the same prior."""
    return next((p for p in reversed(pubs) if period and period_key(p["collection_period"]) and period_key(p["collection_period"]) < period), None)

def build_context(store: SqlStore, upload: dict, deal_obj: dict | None = None) -> Context:
    slug = upload["deal_slug"]
    period = period_key(upload.get("collection_period")) or period_key((deal_obj or {}).get("collection_period"))
    deal_row = store.deal(slug)
    program = store.program(deal_row["program_slug"]) if deal_row else None
    pubs = store.publications(slug)
    prior = (prior_publication(pubs, period) or {}).get("deal")
    defs = store.covenant_definitions(slug)
    # covenants_recorded: current definitions for the deal at any effective date. R14 raises one note for a deal with
    # none, and one per covenant when the deal has some but none in force for this period (Stride before 2026-01-22).
    master = {"program": program, "deal": deal_row, "covenants": covenants_as_of(defs, period_end(period) if period else None),
              "covenants_recorded": len(defs)}
    # {period: published_at}: membership works like the API's set, and R12 can name the publication's date
    return Context(prior=prior, master=master, published_periods={p["collection_period"]: p["published_at"] for p in pubs}, upload=upload_dict(store, upload))

def validate_extraction(store, extraction_id, phases=PHASES, rules_doc: dict | None = None) -> list[dict]:
    """Run the rules over one stored extraction, with the upload's active review edits applied. Findings carry this extraction's id and are not yet persisted."""
    ex = store.extraction(extraction_id)
    if ex is None: raise LookupError(f"extraction {extraction_id} not found")
    upload = store.upload(ex["upload_id"])
    if upload is None: raise LookupError(f"upload {ex['upload_id']} not found")
    meta = dict(ex["meta"])
    if not meta.get("reporting_period") and upload.get("reporting_period"): meta["reporting_period"] = upload["reporting_period"]
    # review edits in force are applied before the rules run, as api/app/review.rerun does, so a pass 2 arriving during
    # review does not undo them; the stored extraction stays the raw read
    deal = apply_edits(ex["deal"], store.active_edits(upload["id"]))
    findings = run({"meta": meta, "deal": deal, "sources": ex.get("sources") or {}}, build_context(store, upload, deal), phases=phases, rules_doc=rules_doc)
    for f in findings: f["extraction_id"] = str(ex["id"])
    return findings

def retry_pages(findings: list[dict], rules_doc: dict | None = None) -> list[int]:
    """Pages for the one automatic pass 2: source pages of open block findings whose rule says retry_pass_2_then_review."""
    retry = {r["id"] for r in (rules_doc or load_rules())["rules"] if r.get("on_failure") == "retry_pass_2_then_review"}
    return sorted({f["source_page"] for f in findings if f["severity"] == "block" and f["rule_id"] in retry and f.get("source_page")})

def _key(f): return (f["rule_id"], tuple(f.get("fields") or []), (f.get("context") or {}).get("vintage"), (f.get("context") or {}).get("legal_ref"))

def resolved_by_pass_2(pass1: list[dict], pass2: list[dict]) -> list[dict]:
    """Open pass-1 findings with no counterpart in pass 2, marked resolved_by_pass_2."""
    still = {_key(f) for f in pass2}
    return [{**f, "status": "resolved_by_pass_2"} for f in pass1 if f.get("status", "open") == "open" and _key(f) not in still]

# ---------- reviewer resolutions across re-extraction ----------
CARRIED_STATUSES = ("overridden", "accepted_as_restatement")   # every status a reviewer's choice sets (api/app/review.CHOICE_STATUS)

def _canon(v):
    """A JSON value in a form that compares equal across a database round trip: numbers as floats rounded to 9 places
    (numeric columns come back as Decimal / float, 12 and 12.0 are the same value), containers recursively."""
    if isinstance(v, bool) or v is None or isinstance(v, str): return v
    if isinstance(v, (int, float, decimal.Decimal)): return round(float(v), 9)
    if isinstance(v, dict): return {str(k): _canon(x) for k, x in sorted(v.items(), key=lambda kv: str(kv[0]))}
    if isinstance(v, (list, tuple)): return [_canon(x) for x in v]
    return str(v)

def same_finding(old: dict, new: dict) -> bool:
    """The same underlying finding with nothing it compares changed: same rule, fields, vintage and legal ref (_key),
    same severity, same targets (compared when the stored finding has them: the column arrives with migration 005),
    same our_value / report_value / difference, and the same context (the terms of the identity the card shows).
    Anything else is a different finding, or the same check on different numbers."""
    if _key(old) != _key(new) or old.get("severity") != new.get("severity"): return False
    return all(_canon(old.get(k)) == _canon(new.get(k)) for k in ("our_value", "report_value", "difference", "unit")) \
        and ("targets" not in old or _canon(old.get("targets") or []) == _canon(new.get("targets") or []))         and _canon(old.get("context") or {}) == _canon(new.get("context") or {})

def carry_resolutions(previous: list[dict], new: list[dict]) -> list[tuple[dict, dict]]:
    """Give each new finding the reviewer's decision on the same finding in the upload's previous extraction: status
    and resolution (who, when, choice, reason) are copied when same_finding holds; a finding whose values changed, or
    that is new, stays open. One previous finding resolves at most one new finding. Mutates `new`; returns the
    (previous, new) pairs carried."""
    pool = [f for f in previous if f.get("status") in CARRIED_STATUSES and f.get("resolution")]
    pairs = []
    for nf in new:
        if nf.get("status", "open") != "open": continue
        old = next((f for f in pool if same_finding(f, nf)), None)
        if old is None: continue
        pool.remove(old)
        nf["status"], nf["resolution"] = old["status"], copy.deepcopy(old["resolution"])
        pairs.append((old, nf))
    return pairs

def counts(findings: list[dict]) -> dict:
    """finding_counts for the upload summary: open findings by severity."""
    out = {"block": 0, "review": 0, "note": 0}
    for f in findings:
        if f.get("status", "open") == "open": out[f["severity"]] += 1
    return out

# ---------- writes ----------
FINDING_COLUMNS = ("id", "extraction_id", "rule_id", "layer", "severity", "message", "fields", "our_value", "report_value", "difference", "tolerance", "unit", "source_page", "context", "status", "resolution", "created_at")
_JSON_COLUMNS = {"fields", "our_value", "report_value", "context", "resolution", "targets"}

def _finding_columns(conn) -> tuple:
    """FINDING_COLUMNS plus `targets` when the finding table has that column (finding.schema.json wave 3; the
    column arrives with a migration, so the worker keeps working on a database that does not have it yet)."""
    try: names = {c["name"] for c in inspect(conn).get_columns("finding")}
    except Exception: names = set()
    return FINDING_COLUMNS + (("targets",) if "targets" in names else ())

def insert_findings(conn, findings: list[dict]) -> int:
    """Insert findings (JSON columns serialised; PostgreSQL casts the text to jsonb; None stays SQL NULL).
    `targets` is written when the table has the column; a finding without targets stores NULL there."""
    if not findings: return 0
    columns = _finding_columns(conn)
    if "targets" not in columns and any(f.get("targets") for f in findings):
        log.warning("finding table has no targets column; override targets not stored (needs the finding.targets migration)")
    cols = ", ".join(columns); params = ", ".join(f":{c}" for c in columns)
    rows = [{c: (_dump(f.get(c)) if c in _JSON_COLUMNS else f.get(c)) for c in columns} for f in findings]
    conn.execute(text(f"insert into finding ({cols}) values ({params})"), rows)
    return len(rows)

def _set_status(c, upload_id, status, from_statuses):
    names = ", ".join(f":f{i}" for i in range(len(from_statuses)))
    return c.execute(text(f"update setrep_upload set status = :s where id = :id and status in ({names})"),
                     {"s": status, "id": str(upload_id), **{f"f{i}": v for i, v in enumerate(from_statuses)}}).rowcount

def mark_extracting(upload_id, conn=None) -> bool:
    """received -> extracting. An upload already extracting (pass 2 queued by the API) is left alone. True if changed."""
    with _tx(conn) as c:
        return _set_status(c, upload_id, "extracting", ("received",)) == 1

def mark_failed(upload_id, error: str, conn=None) -> None:
    """-> extraction_failed (from received / extracting), log the error, write an audit row.
    The audit row uses action 'extract' with actor_role 'system': the contract's AuditEntry.action enum has no
    'extraction_failed', and 'extract' + reason is what the API itself writes when it cannot queue a job."""
    log.error("extraction failed for upload %s: %s", upload_id, error)
    with _tx(conn) as c:
        _set_status(c, upload_id, "extraction_failed", ("received", "extracting"))
        c.execute(text("insert into review_action (id, upload_id, actor_role, actor_label, action, reason, detail) values (:id, :u, 'system', 'worker', 'extract', :r, :d)"),
                  {"id": str(uuid.uuid4()), "u": str(upload_id), "r": (error or "")[:1000], "d": json.dumps({"status": "extraction_failed"})})

STALE_MINUTES = 15   # an extraction takes seconds to a few minutes; nothing waits this long with no job in the queue
INTERRUPTED = ("Extraction did not finish: the worker stopped while this upload was waiting or being read, and no job is "
               "queued for it. Re-extract to try again.")

def recover_stale(queued_ids=(), older_than_minutes: float | None = None, conn=None, now: dt.datetime | None = None) -> list[str]:
    """Uploads left in received / extracting whose job is gone: BLPOP takes a job off the queue before the work starts,
    so a worker killed mid-job (or before it marked the upload) leaves the upload there for good. Any such upload with
    no job waiting in the queue (`queued_ids`: upload ids of the jobs still in the list) and nothing recorded for it in
    the last `older_than_minutes` (WORKER_STALE_MINUTES, default 15) is marked extraction_failed with a plain reason,
    audited like any failed extraction, so the operator can re-extract. Called at worker start and every few minutes,
    between jobs, so the calling worker's own job is never in flight. Returns the upload ids failed."""
    if older_than_minutes is None:
        try: older_than_minutes = float(os.environ.get("WORKER_STALE_MINUTES", STALE_MINUTES))
        except ValueError: older_than_minutes = STALE_MINUTES
    now = now or dt.datetime.now(dt.timezone.utc); queued = {str(q) for q in queued_ids}; failed = []
    with _tx(conn) as c:
        for u in SqlStore(c).stuck_uploads():
            last = u.get("last_activity")
            if str(u["id"]) in queued or (last is not None and (now - last).total_seconds() < older_than_minutes * 60): continue
            mark_failed(u["id"], INTERRUPTED, conn=c)
            failed.append(str(u["id"]))
    return failed

def chain_history(store: SqlStore, upload_id: str, extraction: dict, extend) -> dict:
    """extraction = extend(prior published deal, extraction), with the same prior build_context gives the rules.
    No prior (first upload for the deal): returned unchanged. If extend raises, the unchained extraction is returned
    with a note in meta.notes; the upload is not failed for it."""
    u = store.upload(upload_id)
    if u is None: return extraction
    period = period_key(u.get("collection_period")) or period_key((extraction.get("deal") or {}).get("collection_period"))
    prior = prior_publication(store.publications(u["deal_slug"]), period)
    if prior is None: return extraction
    try:
        return extend(copy.deepcopy(prior["deal"]), copy.deepcopy(extraction))
    except Exception as e:
        log.exception("history chaining failed for upload %s; continuing unchained", upload_id)
        out = copy.deepcopy(extraction); meta = out.setdefault("meta", {})
        meta["notes"] = list(meta.get("notes") or []) + [f"history not chained onto the {prior['collection_period']} publication: {type(e).__name__}: {e}"]
        return out

def handle_extraction(job: dict, extraction: dict, conn=None, enqueue=None, extend=None) -> dict:
    """Store one extraction for job["pass"], validate it, store its findings and move the upload on.
    With `extend` (worker/extract/history.py, injected by worker/main.py), the extraction is first chained onto the
    prior published deal (chain_history), so the stored row, the rules and a later approve all see the full history.
    Pass 1: block findings that ask for a retry queue {"upload_id", "pass": 2, "pages"} (status stays extracting);
    otherwise, or if the queue is unavailable (enqueue=False or it raises), needs_review.
    Pass 2: open pass-1 findings pass 2 no longer produces become resolved_by_pass_2; needs_review.
    Any re-extraction (automatic pass 2, or a re-extract during review): a finding the reviewer already resolved on the
    upload's previous extraction keeps that resolution when it is the same finding on the same values (carry_resolutions).
    Returns {"extraction_id", "status", "counts", "carried"}."""
    upload_id, pass_ = str(job["upload_id"]), int(job.get("pass", 1))
    eid = str(uuid.uuid4())
    with _tx(conn) as c:
        store = SqlStore(c)
        if extend is not None: extraction = chain_history(store, upload_id, extraction, extend)
        meta = {**(extraction.get("meta") or {}), "upload_id": upload_id, "pass": pass_}
        prev = store.latest_extraction(upload_id, 1) if pass_ == 2 else None
        last = store.previous_extraction(upload_id)   # before the insert: the extraction the reviewer has been working on
        c.execute(text("insert into extraction (id, upload_id, pass, meta, deal, sources, confidence) values (:id, :u, :p, :m, :d, :s, :conf)"),
                  {"id": eid, "u": upload_id, "p": pass_, "m": json.dumps(meta), "d": json.dumps(extraction["deal"]), "s": json.dumps(extraction.get("sources") or {}),
                   "conf": meta.get("confidence")})
        if meta.get("reporting_period"):
            c.execute(text("update setrep_upload set reporting_period = :r where id = :id"), {"r": meta["reporting_period"], "id": upload_id})
        findings = validate_extraction(store, eid)
        carried = carry_resolutions(store.findings(last["id"]), findings) if last else []
        if carried: log.info("upload %s: %d reviewer resolution(s) carried over to extraction %s", upload_id, len(carried), eid)
        insert_findings(c, findings)
        pages = retry_pages(findings) if pass_ == 1 else []
        if pass_ == 2 and prev:
            cleared = resolved_by_pass_2(store.findings(prev["id"]), findings)
            for f in cleared:
                c.execute(text("update finding set status = 'resolved_by_pass_2' where id = :id and status = 'open'"), {"id": str(f["id"])})
        status = "extracting" if pages and enqueue is not False else "needs_review"
        _set_status(c, upload_id, status, ("received", "extracting"))
    if status == "extracting":
        try:
            (enqueue or redis_enqueue)({"upload_id": upload_id, "pass": 2, "pages": pages, **({"template_id": job["template_id"]} if job.get("template_id") else {})})
        except Exception as e:   # queue down: the reviewer still gets the pass-1 findings
            log.error("pass-2 enqueue failed for %s: %s", upload_id, e)
            with _tx(conn) as c: _set_status(c, upload_id, "needs_review", ("extracting",))
            status = "needs_review"
    return {"extraction_id": eid, "status": status, "counts": counts(findings), "carried": len(carried)}
