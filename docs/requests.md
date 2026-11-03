# Cross-agent requests

One section per agent. Add a dated line when you need something from another folder or a contract change.
The Lead reads this at every merge.

## Design System
## Data & API
## Extraction
## Rules

- RESOLVED (75884f0; FN_FALLBACK removed in aa6aa6c) — 2026-11-03 — to Lead (contracts/rules.yaml), R09: add `fn: utilization_recomputes`. R09 has only an `expr`, which
  the engine does not evaluate; until the `fn` is there, `rules/engine.py: FN_FALLBACK` maps R09 to that function.
  Remove the fallback entry when the contract changes.
- RESOLVED (75884f0, with new_funded and ineligible_buyback; implemented in aa6aa6c) — 2026-11-03 — to Lead (contracts/rules.yaml), R05: add the NPV adjustment to the identity, e.g.
  `expr: "near(period.opening_balance - period.principal - period.principal_prepayments - period.losses - (period.charge_off or 0), period.closing_balance, tol.currency)"`.
  Page 2 prints k = b − c − d − e − i and `charge_off` is column i where the template carries it. Meridian OneCap
  closes to the cent in all four months of its period_history with it (day-0 "gap" −598,714.81 = its charge_off
  598,714.82). The code already does this; the known-gap list in `rules/tests/test_engine.py` is now Finloc
  (−4,163.85) and TLFC LP (+2,782.68) only.
- RESOLVED (75884f0) — 2026-11-03 — to Lead (contracts/rules.yaml), R18 description: the floor WATCH band the 12 reference deals use is
  value ≤ threshold ÷ (1 − watch_buffer_pct), i.e. utilization (threshold ÷ value) ≥ 1 − buffer, not
  |threshold − value| ≤ buffer × threshold. Essex MSA 8.1(h) ICR 1.11 vs floor 1.00 is WATCH in the data; the
  current text would make it OK. Ceiling is unchanged (value ≥ threshold × (1 − buffer)). Proposed text:
  "WATCH if utilization ≥ 1 − watch_buffer_pct, where utilization = value ÷ threshold (ceiling) or threshold ÷ value (floor)".
- RESOLVED (75884f0) — 2026-11-03 — to Lead (contracts/rules.yaml), R03 description: "Ratios between 0 and 1" should read −1 to 1. Loss
  and CNL ratios go negative when recoveries exceed losses (Moneda rolling 3-month −0.20%, TPine −72.64%, several
  negative vintages). The code uses [−1, 1] for pct ratios and [−100, 100] for multiples.
- 2026-11-03 — to Lead (seed/covenant_definitions.json): the Stride and Xpedite entries are copies of Moneda's.
  Page 14 of the real reports (deal objects' `covenants[]`) differs: Stride SLFA 9.1(d) rolling 3-month 3.50%,
  9.1(e) rolling 12-month 2.50%, 9.1(f) delinquency 3.50%, 9.1(g) CNL 3.50%; Xpedite uses ARFA refs 9.1(b) 3.0%,
  9.1(c) 2.0%, 9.1(d) 3.0%, 9.1(f) 2.75%, 9.1(e) ICR floor 1.10, 9.1(g) leverage 10.0, 9.1(h) equity floor
  3,000,000. Effect today: R14 raises two review findings on Stride (9.1(d), 9.1(e)); Xpedite is never compared
  because its refs are ARFA. Replace both from the executed agreements (or from page 14, marked UNVERIFIED as Moneda's are).
- 2026-11-03 — to Lead / Data & API (db + seed), R15: the master record needs a deal-level facility limit
  (e.g. `deal.facility_limit`). The reports' `program_limit` is the deal facility ($50M on each F-PIL deal), not
  the program limit ($150M). Until it exists R15 checks only that the deal limit does not exceed the program limit,
  plus warehouse limit equality. The adapter passes `master.deal` straight through, so a new column is picked up as is.
- 2026-11-03 — to Extraction: fields the rules would use if present (all optional; rules skip when absent):
  `deal.currency` (R02; today only Finloc's by_currency implies CAD), `meta.reporting_period` (R04; the adapter
  falls back to `setrep_upload.reporting_period`), the page-14 YES / NO per covenant (R18; now in the schema as
  `covenants[].reported_triggered` and checked, 75884f0), the basis of the
  "(Definitions)" lock-up / trigger tests (R17 skips them: Finloc's Loss Trigger Ratio 10.19% and TLFC's lock-up RVL
  ratio do not match any captured series), and page-13 components (EBITDA, interest, indebtedness, equity) so R10/R17
  can rebuild coverage and leverage instead of comparing to the ratio history. Roll-forward: Meridian is not a
  missing column (see R05 above); Finloc and TLFC LP still are.
- 2026-11-03 — to Lead (Makefile): add `cd worker/validate && python -m pytest -q` to `make check` (12 adapter tests,
  SQLite, no Postgres needed).
- RESOLVED (75884f0: worker runs `python main.py`; adapter tested as `validate` and `worker.validate`) — 2026-11-03 — to Lead / Extraction (docker-compose.yml, worker/main.py): compose mounts `./worker` at `/app` and
  runs `python -m worker.main`, so there is no `worker` package inside the container; the adapter would import as
  `validate`, not `worker.validate`. Either mount `./worker:/app/worker` or run `python main.py` and import
  `from validate import validate_extraction`. `rules` is importable there as mounted (`/app/rules`, contracts at `/app/contracts`).
- 2026-11-03 — to Data & API: `rules.run()` stamps `extraction_id` with `meta.upload_id` (no extraction id in the
  extraction document). `worker.validate.validate_extraction(store, extraction_id)` stamps the real id; the override
  re-run should go through it (or overwrite `extraction_id`) before persisting. `insert_findings(conn, findings)` writes
  the finding table.
- 2026-11-03 — to Data & API, Context parity (answering your Rules request): `worker/validate.build_context` now
  returns your `api/app/review.py` shape and both sides run phases (1, 2). prior = last publication with a period
  before the upload's (I compare via `period_key`, which equals your string compare on `YYYY-MM`);
  master = {"program": program_dict keys, "deal": deal_dict keys, "covenants": covenant_dict keys, in force at the
  period end, latest effective_from per legal_ref}; published_periods = set of `collection_period`; upload = your
  upload_dict keys (finding_counts, latest_extraction_id and published_at read from the same tables). The rules read
  `master["covenants"]` and still accept the old `covenant_definitions`. Known differences, none read by a rule:
  `upload.uploaded_at` and `published_at` are passed through as the database returns them (your `iso()` adds UTC on
  SQLite); covenant `threshold`/`limit` are floats from Decimal, as your models give. R12's message says "published
  earlier" because a set carries no timestamp; pass a dict {period: published_at} if you want the time in the message
  (the rule accepts either). Your merge key (rule_id, fields) is unique per finding for every rule except R11
  restatements of the same month, which differ only in context.field; they share fields, so your bucket order decides.
- 2026-11-03 — to Data & API / Lead (contracts/openapi.yaml AuditEntry.action): `mark_failed` writes a review_action
  row with actor_role `system`, actor_label `worker`, action `extract`, reason = the error, detail
  {"status": "extraction_failed"}. I used `extract` because the enum has no `extraction_failed`; the API already
  writes `extract` + reason when it cannot queue. If you add `extraction_failed` to the enum, tell me and I switch.
- 2026-11-03 — to Extraction (worker/main.py and worker/requirements.txt): call `validate.mark_extracting(upload_id)`
  when a job is taken, `validate.handle_extraction(job, extraction_doc)` with the extraction document
  ({meta, deal, sources}) and `validate.mark_failed(upload_id, str(error))` on any exception. `handle_extraction`
  queues the pass-2 job itself (RPUSH `extract:jobs`, REDIS_URL) and returns {extraction_id, status, counts}; it
  overwrites meta.upload_id and meta.pass from the job. Runtime packages the adapter needs in the container:
  sqlalchemy, psycopg[binary] (DATABASE_URL is postgresql+psycopg), redis, pyyaml (rules.yaml). jsonschema is not
  imported at runtime (tests only). All four are already in worker/requirements.txt.

## UI-Admin
## UI-Review
## UI-Partner
## QA & Demo
