"""Regenerate the per-rule fixtures from the real deal objects in docs/dashboard-json.

    python rules/tests/fixtures/make_fixtures.py

Each rule gets <rule>-pass.json and <rule>-fail.json here: a real deal object, plus at most one deliberate change
(recorded under "change", applied to the deal or to the context), the meta and the Context the rule runs with.
The failing case's expected finding is frozen to findings/<rule>-fail.json (validated by scripts/check_contracts.py).
Never edit the JSON by hand; change SPECS and rerun. test_rules.py checks each fixture against its source deal."""
import copy, json, pathlib, sys, uuid
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
from rules.engine import Context, run  # noqa: E402

META = {"upload_id": "00000000-0000-4000-8000-000000000000", "pass": 1, "template_id": "fpil-2.0-settrep-v1", "page_count": 16,
        "extracted_at": "2026-10-28T00:00:00Z", "engine": {"text_layer": "pdfplumber", "model": "claude"}}
MONEDA, STRIDE, XPEDITE, FINLOC = (f"{s}.dashboard.json" for s in ("f-pil-2-0-moneda-capital-corp", "f-pil-2-0-stride-capital", "f-pil-2-0-xpedite-leasing", "move-trust-finloc-2000-inc"))

def load_deal(name): return json.loads((ROOT / "docs/dashboard-json" / name).read_text(encoding="utf-8"))
def seed(name): return json.loads((ROOT / "seed" / name).read_text(encoding="utf-8"))

def master_for(slug):
    """Master record as worker/validate builds it, from the seed files."""
    deal = next(d for d in seed("deals.json") if d["slug"] == slug)
    prog = next(p for p in seed("programs.json") if p["slug"] == deal["program_slug"])
    return {"program": prog, "deal": deal, "covenant_definitions": [c for c in seed("covenant_definitions.json") if c["deal_slug"] == slug]}

def prior_from_history(d):
    """The prior period's published values, taken from the rows this deal object already carries for that month
    (period_history row for the prior period, ratio_history without the current month). Real numbers only."""
    d = copy.deepcopy(d)
    rows = [r for r in d["period_history"] if r["collection_period"] != d["collection_period"]]
    last = rows[-1]
    return {"deal_slug": d["deal_slug"], "collection_period": last["collection_period"],
            "tranche_balance": {"opening": last["opening_balance"], "closing": last["closing_balance"]},
            "contracts": {"opening": last["opening_contracts"], "closing": last["closing_contracts"]},
            "period_history": rows, "ratio_history": d["ratio_history"][:-1], "covenants": d["prior_covenants"]}

def upload_for(d):
    deal = next(x for x in seed("deals.json") if x["slug"] == d["deal_slug"])
    return {"deal_slug": deal["slug"], "deal_name": deal["name"], "collection_period": "2026-08" if d["collection_period"] == "August 2026" else "2026-07"}

# rule -> (source deal, context builder(deal) -> dict of Context kwargs, meta overrides, fail change)
# A change is {"target": "deal" | "context" | "meta", "path": JSON pointer, "value": new value}.
SPECS = {
    "R01": (MONEDA, lambda d: {}, {}, {"target": "deal", "path": "/tranche_balance/closing", "value": None, "why": "closing balance not found on page 2"}),
    "R02": (FINLOC, lambda d: {"master": master_for(d["deal_slug"])}, {}, {"target": "deal", "path": "/currency", "value": "USD", "why": "report currency read as USD; facility is CAD"}),
    "R03": (MONEDA, lambda d: {}, {}, {"target": "deal", "path": "/financial_ratios/0/value", "value": 1.79, "why": "delinquency ratio 1.79% read as 1.79"}),
    "R04": (MONEDA, lambda d: {}, {"reporting_period": "2026-07"}, {"target": "deal", "path": "/settlement_date", "value": "October 7, 2026", "why": "settlement month misread"}),
    "R05": (MONEDA, lambda d: {}, {}, {"target": "deal", "path": "/period_history/3/principal", "value": 647926.71, "why": "scheduled principal 646,926.71 read as 647,926.71"}),
    "R06": (XPEDITE, lambda d: {}, {}, {"target": "deal", "path": "/contracts/closing", "value": 656.0, "why": "closing contracts 655 read as 656"}),
    "R07": (MONEDA, lambda d: {}, {}, {"target": "deal", "path": "/aging_history/0/days_31_60", "value": 103234.99, "why": "31-60 bucket 102,234.99 read as 103,234.99"}),
    "R08": (MONEDA, lambda d: {}, {}, {"target": "deal", "path": "/cnl_by_period/0/actual_recoveries", "value": 2252563.34, "why": "actual recoveries 2,252,653.34 transposed to 2,252,563.34"}),
    "R09": (MONEDA, lambda d: {}, {}, {"target": "deal", "path": "/program/unused_facility", "value": 34908028.48, "why": "unused facility 34,980,028.48 transposed to 34,908,028.48"}),
    "R10": (STRIDE, lambda d: {}, {}, {"target": "deal", "path": "/total_enhancement/total_enhancement_pct", "value": 0.1728, "why": "enhancement 12.78% transposed to 17.28%"}),
    "R11": (MONEDA, lambda d: {"prior": prior_from_history(d)}, {}, {"target": "deal", "path": "/tranche_balance/opening", "value": 15793784.34, "why": "opening balance 15,792,784.34 read as 15,793,784.34"}),
    "R12": (MONEDA, lambda d: {"published_periods": {"2026-07": "2026-07-15T14:02:00Z"}}, {},
            {"target": "context", "path": "/published_periods/2026-08", "value": "2026-08-12T16:40:00Z", "why": "August 2026 already published for Moneda"}),
    "R13": (MONEDA, lambda d: {"upload": upload_for(d)}, {}, {"target": "context", "path": "/upload/deal_slug", "value": "f-pil-2-0-stride-capital", "why": "analyst selected Stride, uploaded the Moneda file"}),
    "R14": (MONEDA, lambda d: {"master": master_for(d["deal_slug"])}, {}, {"target": "deal", "path": "/covenants/0/threshold", "value": 0.06, "why": "9.1(c) threshold read from the below-$10M band; balance is $15.0M"}),
    "R15": (MONEDA, lambda d: {"master": master_for(d["deal_slug"])}, {}, {"target": "deal", "path": "/warehouse/maximum_warehouse_facility_limit", "value": 500000.0, "why": "warehouse limit 5,000,000 read as 500,000"}),
    "R17": (MONEDA, lambda d: {}, {}, {"target": "deal", "path": "/covenants/2/current_value", "value": 0.0197, "why": "delinquency ratio 1.79% transposed to 1.97%"}),
    "R18": (MONEDA, lambda d: {}, {}, {"target": "deal", "path": "/covenants/3/status", "value": "OK", "why": "CNL 3.30% vs 3.50% is inside the 10% watch buffer"}),
    "R19": (MONEDA, lambda d: {}, {}, {"target": "deal", "path": "/prior_covenants/2/status", "value": "WATCH", "why": "delinquency was WATCH last period; OK now"}),
}

def set_ptr(obj, ptr, value):
    parts = ptr.strip("/").split("/"); cur = obj
    for p in parts[:-1]: cur = cur[int(p)] if isinstance(cur, list) else cur.setdefault(p, {})
    last = parts[-1]
    if isinstance(cur, list): cur[int(last)] = value
    else: cur[last] = value

def build(rule_id, case):
    src, ctx_fn, meta_over, change = SPECS[rule_id]
    deal = load_deal(src); meta = {**META, **meta_over}; context = ctx_fn(deal)
    if case == "fail":
        target = {"deal": deal, "context": context, "meta": meta}[change["target"]]
        set_ptr(target, change["path"], copy.deepcopy(change["value"]))
    return {"rule_id": rule_id, "case": case, "source": f"docs/dashboard-json/{src}", "change": change if case == "fail" else None,
            "meta": meta, "context": context, "deal": deal}

def context_of(fx):
    c = dict(fx["context"])
    if isinstance(c.get("published_periods"), list): c["published_periods"] = set(c["published_periods"])
    return Context(**c)

def evaluate(fx):
    return run({"meta": fx["meta"], "deal": fx["deal"], "sources": {}}, context_of(fx), only={fx["rule_id"]})

def frozen(f, i=0):
    f = dict(f); f["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, f"tao-admin-poc/fixture/{f['rule_id']}/{i}")); f["created_at"] = "2026-10-28T00:00:00Z"
    return f

def main():
    for rule_id in SPECS:
        for case in ("pass", "fail"):
            fx = build(rule_id, case)
            (HERE / f"{rule_id.lower()}-{case}.json").write_text(json.dumps(fx, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
            fs = evaluate(fx)
            if case == "pass": assert not fs, f"{rule_id} pass fixture fired: {[f['message'] for f in fs]}"
            else:
                assert fs, f"{rule_id} fail fixture did not fire"
                for i, f in enumerate(fs):   # one change can break more than one identity (R06: the closing count and the movers bound)
                    (HERE / "findings" / expected_name(rule_id, i)).write_text(json.dumps(frozen(f, i), indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
                    print(rule_id, "->", f["message"])

def expected_name(rule_id, i): return f"{rule_id.lower()}-fail.json" if i == 0 else f"{rule_id.lower()}-fail-{i + 1}.json"

if __name__ == "__main__":
    main()
