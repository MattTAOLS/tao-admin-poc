"""Regenerate the per-rule fixtures from the real deal objects in docs/dashboard-json.

    python rules/tests/fixtures/make_fixtures.py

Each rule gets <rule>-pass.json and <rule>-fail.json here: a real deal object, plus at most one deliberate change
(recorded under "changes", applied to the deal or to the context), the meta and the Context the rule runs with.
EXTRA adds named fixtures for specific terms (r05-new-funded, r05-ineligible-buyback, the MOVE Trust R05 terms
r05-adjustment-increase / r05-charge-off-move / r05-balance-adjustment, r18-reported-triggered).
Their failing case is one change; a passing case may need two changes on the same row to stay consistent
(a new-funded amount offset by principal), and records both.
The failing case's expected findings are frozen to findings/<name>-fail.json (validated by scripts/check_contracts.py).
Never edit the JSON by hand; change SPECS and rerun. test_rules.py checks each fixture against its source deal."""
import copy, json, pathlib, sys, uuid
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
from rules.engine import Context, run  # noqa: E402

META = {"upload_id": "00000000-0000-4000-8000-000000000000", "pass": 1, "template_id": "fpil-2.0-settrep-v1", "page_count": 16,
        "extracted_at": "2026-10-28T00:00:00Z", "engine": {"text_layer": "pdfplumber", "model": "claude"}}
MONEDA, STRIDE, XPEDITE, FINLOC = (f"{s}.dashboard.json" for s in ("f-pil-2-0-moneda-capital-corp", "f-pil-2-0-stride-capital", "f-pil-2-0-xpedite-leasing", "move-trust-finloc-2000-inc"))
TLFC_LP, MERIDIAN = (f"{s}.dashboard.json" for s in ("move-trust-tlfc-lp-leases", "move-trust-meridian-onecap-lp"))

def load_deal(name): return json.loads((ROOT / "docs/dashboard-json" / name).read_text(encoding="utf-8"))
def seed(name): return json.loads((ROOT / "seed" / name).read_text(encoding="utf-8"))

def master_for(slug):
    """Master record as worker/validate builds it, from the seed files."""
    deal = next(d for d in seed("deals.json") if d["slug"] == slug)
    prog = next(p for p in seed("programs.json") if p["slug"] == deal["program_slug"])
    return {"program": prog, "deal": deal, "covenants": [c for c in seed("covenant_definitions.json") if c["deal_slug"] == slug]}

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

def single_month(d):
    """What one SetRep yields before history chaining: the current period row and aging row only, no cross-report
    fields (the report's own 13-month ratio_history is printed on it, so it stays)."""
    d = copy.deepcopy(d)
    d["period_history"] = [r for r in d["period_history"] if r["collection_period"] == d["collection_period"]]
    d["aging_history"] = d["aging_history"][:1]
    d["balance_discontinuities"], d["restatements"] = [], []
    return d

def prior_state(d):
    """The previous month's published deal, rebuilt from the rows this (chained) object carries for earlier months:
    period_history and aging_history up to that month, ratio_history without the current month, prior covenants and
    closings. Real numbers only; fields the current object has no earlier value for are left as they are."""
    p = copy.deepcopy(d)
    rows = [r for r in p["period_history"] if r["collection_period"] != d["collection_period"]]
    last = rows[-1]
    p.update(collection_period=last["collection_period"], period_history=rows, aging_history=p["aging_history"][1:], ratio_history=p["ratio_history"][:-1],
             covenants=p["prior_covenants"], tranche_balance={**p["tranche_balance"], "opening": last["opening_balance"], "closing": last["closing_balance"], "all_tranches": []},
             contracts={**p["contracts"], "opening": last["opening_contracts"], "closing": last["closing_contracts"]})
    return p

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

# name -> (rule, source deal, context builder, meta overrides, pass changes, fail changes)
CUR = "/period_history/3"   # Moneda's current period (August 2026) row; also the current (July 2026) row of every MOVE Trust deal
# MOVE Trust roll-forward terms the references do not carry (charge_off null, no adjustment_increase): the values are
# the July 2026 extraction's (agent/extraction, worker/extract/tests/test_move_guarantor.py / test_move_multicurrency.py),
# and they close the two documented reference gaps (test_engine.py KNOWN_ROLLFORWARD_GAPS) to the cent.
EXTRA = {
    "r05-new-funded": ("R05", MONEDA, lambda d: {}, {},
        [{"target": "deal", "path": f"{CUR}/new_funded", "value": 1000.0, "why": "a 1,000.00 advance funded in the period"},
         {"target": "deal", "path": f"{CUR}/principal", "value": 647926.71, "why": "offset: principal 1,000.00 higher, closing unchanged"}],
        [{"target": "deal", "path": f"{CUR}/new_funded", "value": 1000.0, "why": "new funded printed but not carried into the closing balance"}]),
    "r05-ineligible-buyback": ("R05", MONEDA, lambda d: {}, {},
        [{"target": "deal", "path": f"{CUR}/ineligible_buyback", "value": 1000.0, "why": "1,000.00 of the principal line was an ineligible buyback"},
         {"target": "deal", "path": f"{CUR}/principal", "value": 645926.71, "why": "offset: principal 1,000.00 lower, closing unchanged"}],
        [{"target": "deal", "path": f"{CUR}/ineligible_buyback", "value": 1000.0, "why": "buyback printed but the closing balance does not reflect it"}]),
    "r05-adjustment-increase": ("R05", TLFC_LP, lambda d: {}, {"template_id": "move-trust-settrep-v1"},
        [{"target": "deal", "path": f"{CUR}/adjustment_increase", "value": 2782.68, "why": "July upward part of page 2 'Adjustment to Portfolio (+/-)', as extracted"}],
        [{"target": "deal", "path": f"{CUR}/charge_off", "value": 2782.68, "why": "the +2,782.68 portfolio adjustment read as a charge-off (sign lost)"}]),
    "r05-charge-off-move": ("R05", FINLOC, lambda d: {}, {"template_id": "move-trust-settrep-v1"},
        [{"target": "deal", "path": f"{CUR}/charge_off", "value": 4163.85, "why": "July downward part of page 2 'Adjustment to Portfolio (+/-)', as extracted"}],
        [{"target": "deal", "path": f"{CUR}/adjustment_increase", "value": 4163.85, "why": "the -4,163.85 portfolio adjustment read as an increase (sign lost)"}]),
    "r05-balance-adjustment": ("R05", MERIDIAN, lambda d: {}, {"template_id": "move-trust-settrep-v1"},
        [{"target": "deal", "path": f"{CUR}/balance_adjustment", "value": -1000.0, "why": "a signed -1,000.00 tranche contract balance adjustment"},
         {"target": "deal", "path": f"{CUR}/principal", "value": 7350226.06, "why": "offset: principal 1,000.00 lower, closing unchanged"}],
        [{"target": "deal", "path": f"{CUR}/balance_adjustment", "value": 1000.0, "why": "balance adjustment printed but not carried into the closing balance"}]),
    "r12-reissue": ("R12", MONEDA, lambda d: {"upload": {**upload_for(d), "replaces_upload_id": "11111111-1111-4111-8111-111111111111"},
                                               "published_periods": {"2026-07": "2026-07-15T14:02:00Z"}}, {},
        [],
        [{"target": "context", "path": "/published_periods/2026-08", "value": "2026-08-12T16:40:00Z", "why": "re-issue of the published August 2026 report"}]),
    "r12-reissue-later": ("R12", MONEDA, lambda d: {"upload": {**upload_for(d), "replaces_upload_id": "11111111-1111-4111-8111-111111111111"},
                                                     "published_periods": {"2026-07": "2026-07-15T14:02:00Z", "2026-09": "2026-09-14T10:00:00Z", "2026-10": "2026-10-13T10:00:00Z"}}, {},
        [],
        [{"target": "context", "path": "/published_periods/2026-08", "value": "2026-08-12T16:40:00Z", "why": "re-issue of August 2026 after September and October were published"}]),
    "r18-reported-triggered": ("R18", MONEDA, lambda d: {}, {},
        [{"target": "deal", "path": "/covenants/5/reported_triggered", "value": "NO", "why": "ICR 1.27 vs floor 1.10: report answers NO"}],
        [{"target": "deal", "path": "/covenants/5/reported_triggered", "value": "YES", "why": "report answers YES on SLFA 9.1 (h) while the value is OK (as Moneda May 2026 prints)"}]),
}
NAMES = [r.lower() for r in SPECS] + list(EXTRA)

def spec(name):
    if name in EXTRA: return EXTRA[name]
    src, ctx_fn, meta_over, change = SPECS[name.upper()]
    return name.upper(), src, ctx_fn, meta_over, [], [change]

def set_ptr(obj, ptr, value):
    parts = ptr.strip("/").split("/"); cur = obj
    for p in parts[:-1]: cur = cur[int(p)] if isinstance(cur, list) else cur.setdefault(p, {})
    last = parts[-1]
    if isinstance(cur, list): cur[int(last)] = value
    else: cur[last] = value

def build(name, case):
    rule_id, src, ctx_fn, meta_over, pass_changes, fail_changes = spec(name)
    deal = load_deal(src); meta = {**META, **meta_over}; context = ctx_fn(deal)
    changes = fail_changes if case == "fail" else pass_changes
    for change in changes:
        target = {"deal": deal, "context": context, "meta": meta}[change["target"]]
        set_ptr(target, change["path"], copy.deepcopy(change["value"]))
    return {"rule_id": rule_id, "name": name, "case": case, "source": f"docs/dashboard-json/{src}", "changes": changes,
            "meta": meta, "context": context, "deal": deal}

def context_of(fx):
    c = dict(fx["context"])
    if isinstance(c.get("published_periods"), list): c["published_periods"] = set(c["published_periods"])
    return Context(**c)

def evaluate(fx):
    return run({"meta": fx["meta"], "deal": fx["deal"], "sources": {}}, context_of(fx), only={fx["rule_id"]})

def frozen(f, name, i=0):
    seed_ = f"{f['rule_id']}/{i}" if name == f["rule_id"].lower() else f"{name}/{i}"
    f = dict(f); f["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, f"tao-admin-poc/fixture/{seed_}")); f["created_at"] = "2026-10-28T00:00:00Z"
    return f

def main():
    for name in NAMES:
        for case in ("pass", "fail"):
            fx = build(name, case); rule_id = fx["rule_id"]
            (HERE / f"{name}-{case}.json").write_text(json.dumps(fx, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
            fs = evaluate(fx)
            if case == "pass": assert not fs, f"{rule_id} pass fixture fired: {[f['message'] for f in fs]}"
            else:
                assert fs, f"{rule_id} fail fixture did not fire"
                for i, f in enumerate(fs):   # one change can break more than one identity (R06: the closing count and the movers bound)
                    (HERE / "findings" / expected_name(name, i)).write_text(json.dumps(frozen(f, name, i), indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
                    print(name, "->", f["message"])

def expected_name(name, i): return f"{name.lower()}-fail.json" if i == 0 else f"{name.lower()}-fail-{i + 1}.json"

if __name__ == "__main__":
    main()
