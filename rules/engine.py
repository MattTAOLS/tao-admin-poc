import pathlib, uuid, datetime as dt, yaml
RULES_PATH = pathlib.Path(__file__).resolve().parents[1] / "contracts" / "rules.yaml"

def load_rules(path=RULES_PATH) -> dict:
    return yaml.safe_load(pathlib.Path(path).read_text(encoding="utf-8"))

# Top-level rules.yaml maps a check may need besides its own entry and the tolerances. run() hands them to every rule
# as rule["settings"]; a check called directly with a bare rule entry falls back to settings_of(load_rules()).
SETTINGS_KEYS = ("reporting_lag_months",)

def settings_of(rules_doc: dict) -> dict:
    return {k: rules_doc.get(k) or {} for k in SETTINGS_KEYS}

class Context:
    """What a rule may look at besides the extraction.

    prior              the deal's last PUBLISHED deal object (extraction.deal shape) for an earlier period, or None.
    master             {"program": {slug, name, partner_slug, currency, limit, warehouse_limit},
                        "deal": {slug, name, program_slug, servicer, template_id},
                        "covenants": [covenant definitions in force at the period end, as the API's covenant_dict]}.
                        ("covenant_definitions" is accepted as an older name for "covenants".)
    published_periods  periods ("YYYY-MM") already published for this deal: a set, or a dict period -> published_at.
    upload             the upload the analyst created (API upload_dict shape: id, deal_slug, program_slug,
                        collection_period, reporting_period, ...).
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

def check_failed(rule: dict, extraction: dict, error: Exception) -> dict:
    """Finding for a check that raised on this extraction (a field shape it did not expect). Never weaker than review:
    the reviewer sees the rule was not evaluated, rather than the upload failing or the rule passing silently."""
    uid = ((extraction or {}).get("meta") or {}).get("upload_id")
    sev = rule.get("severity") if rule.get("severity") in ("block", "review") else "review"
    detail = f"{type(error).__name__}: {error}"[:300]
    return finding({**rule, "severity": sev}, uid, context={"error": detail, "title": rule.get("title", rule["id"])},
                   message="{title} could not be checked on this extraction (" + detail.replace("{", "(").replace("}", ")") + "). Re-read the report (pass 2) or check it by hand in review.")

def run(extraction: dict, ctx: Context, phases=(1,), rules_doc: dict | None = None, only: set | None = None) -> list[dict]:
    """Evaluate every enabled rule in the given phases (or just the rule ids in `only`).
    A rule function returns a list of findings (possibly empty)."""
    from . import checks
    rules_doc = rules_doc or load_rules()
    tol = rules_doc["tolerances"]; settings = settings_of(rules_doc); out = []
    for rule in rules_doc["rules"]:
        if only is not None:
            if rule["id"] not in only: continue
        elif rule.get("phase", 1) not in phases: continue
        fn = getattr(checks, rule.get("fn") or "", None)
        if fn is None: continue   # not implemented: skipped so the pipeline runs (R16, R20-R22 in the POC)
        try: out.extend(fn({**rule, "settings": settings}, extraction, ctx, tol))
        except Exception as e:   # a check must never take the upload down: surface it to the reviewer instead
            out.append(check_failed(rule, extraction, e))
    return out
