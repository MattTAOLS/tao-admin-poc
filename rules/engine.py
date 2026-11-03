import pathlib, uuid, datetime as dt, yaml
RULES_PATH = pathlib.Path(__file__).resolve().parents[1] / "contracts" / "rules.yaml"

def load_rules(path=RULES_PATH) -> dict:
    return yaml.safe_load(pathlib.Path(path).read_text())

class Context:
    """What a rule may look at besides the extraction."""
    def __init__(self, prior: dict | None = None, master: dict | None = None, published_periods: set | None = None, upload: dict | None = None):
        self.prior, self.master, self.published_periods, self.upload = prior, master or {}, published_periods or set(), upload or {}

def finding(rule: dict, extraction_id: str, **kw) -> dict:
    f = {"id": str(uuid.uuid4()), "extraction_id": extraction_id, "rule_id": rule["id"], "layer": rule["layer"], "severity": rule["severity"],
         "message": rule["message"], "fields": rule.get("fields", []), "status": "open", "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
         "our_value": None, "report_value": None, "difference": None, "tolerance": None, "unit": None, "source_page": rule.get("source_page_hint"), "context": {}}
    f.update(kw)
    try: f["message"] = rule["message"].format(**f.get("context", {}), **{k: f[k] for k in ("our_value", "report_value", "difference")})
    except (KeyError, IndexError): pass
    return f

def run(extraction: dict, ctx: Context, phases=(1,), rules_doc: dict | None = None) -> list[dict]:
    """Evaluate every enabled rule in the given phases. A rule function returns a list of findings (possibly empty)."""
    from . import checks
    rules_doc = rules_doc or load_rules()
    tol = rules_doc["tolerances"]; out = []
    for rule in rules_doc["rules"]:
        if rule.get("phase", 1) not in phases: continue
        fn = getattr(checks, rule.get("fn", ""), None)
        if fn is None: continue   # not implemented yet: silently skipped so the pipeline runs during wave 1
        out.extend(fn(rule, extraction, ctx, tol))
    return out
