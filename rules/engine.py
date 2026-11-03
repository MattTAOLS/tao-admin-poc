import pathlib, uuid, datetime as dt, yaml
RULES_PATH = pathlib.Path(__file__).resolve().parents[1] / "contracts" / "rules.yaml"

def load_rules(path=RULES_PATH) -> dict:
    return yaml.safe_load(pathlib.Path(path).read_text(encoding="utf-8"))

class Context:
    """What a rule may look at besides the extraction.

    prior              the deal's last PUBLISHED deal object (extraction.deal shape) for an earlier period, or None.
    master             {"program": {slug, currency, limit, warehouse_limit}, "deal": {slug, name, program_slug, ...},
                        "covenant_definitions": [rows as in seed/covenant_definitions.json]}.
    published_periods  periods ("YYYY-MM") already published for this deal: a set, or a dict period -> published_at.
    upload             what the analyst selected before uploading: {deal_slug, deal_name, collection_period, ...}.
    """
    def __init__(self, prior: dict | None = None, master: dict | None = None, published_periods: set | dict | None = None, upload: dict | None = None):
        self.prior, self.master, self.published_periods, self.upload = prior, master or {}, published_periods or set(), upload or {}

def finding(rule: dict, extraction_id: str, **kw) -> dict:
    """Build one finding. `message` in kw overrides the rules.yaml template for sub-checks whose wording differs;
    either way the template is filled from context + our_value/report_value/difference."""
    template = kw.pop("message", rule["message"])
    f = {"id": str(uuid.uuid4()), "extraction_id": extraction_id, "rule_id": rule["id"], "layer": rule["layer"], "severity": rule["severity"],
         "message": template, "fields": rule.get("fields", []), "status": "open", "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
         "our_value": None, "report_value": None, "difference": None, "tolerance": None, "unit": None, "source_page": rule.get("source_page_hint"), "context": {},
         "resolution": None}
    f.update(kw)
    try: f["message"] = template.format(**{**f.get("context", {}), **{k: f[k] for k in ("our_value", "report_value", "difference")}})
    except (KeyError, IndexError, ValueError): pass
    return f

# Rules whose rules.yaml entry carries only an `expr` (no `fn`). The engine does not evaluate expressions; each one is
# implemented as a named function. Remove an entry once the Lead adds the `fn:` to rules.yaml (see docs/requests.md).
FN_FALLBACK = {"R09": "utilization_recomputes"}

def run(extraction: dict, ctx: Context, phases=(1,), rules_doc: dict | None = None, only: set | None = None) -> list[dict]:
    """Evaluate every enabled rule in the given phases (or just the rule ids in `only`).
    A rule function returns a list of findings (possibly empty)."""
    from . import checks
    rules_doc = rules_doc or load_rules()
    tol = rules_doc["tolerances"]; out = []
    for rule in rules_doc["rules"]:
        if only is not None:
            if rule["id"] not in only: continue
        elif rule.get("phase", 1) not in phases: continue
        fn = getattr(checks, rule.get("fn") or FN_FALLBACK.get(rule["id"], ""), None)
        if fn is None: continue   # not implemented: skipped so the pipeline runs (R16, R20-R22 in the POC)
        out.extend(fn(rule, extraction, ctx, tol))
    return out
