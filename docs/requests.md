# Cross-agent requests

One section per agent. Add a dated line when you need something from another folder or a contract change.
The Lead reads this at every merge.

## Design System
- 2026-11-03 — To Lead: I edited `web/package.json` and `web/package-lock.json` (outside my folders; no owner in the table). Added devDependencies: storybook, @storybook/react-vite, @storybook/react, @storybook/addon-essentials, @storybook/addon-a11y, @storybook/blocks (all 8.6.14), @testing-library/react 16, @testing-library/dom 10, @testing-library/user-event 14, jsdom 25, @types/node 20; added script `build-storybook` (writes to `web/dist/storybook`, already git-ignored). Please merge these first so UI agents rebase onto one lockfile.
- 2026-11-03 — To Lead: I created `web/.storybook/` (main.ts, preview.tsx, preview-head.html). Please add it to the Design System row of the ownership table.
- 2026-11-03 — To Lead: `make check` does not run the web suite. Suggest adding `npm --prefix web test` and `npx --prefix web tsc --noEmit -p web` to the `check` target so the tokens-only lint test (`web/src/design/components/__tests__/tokens.test.ts`) guards every merge.
- 2026-11-03 — To Lead (optional contract change): two sidebar colours are derived with `color-mix()` over tokens because no token exists: the nav group label (`--text-on-indigo` at 62% over `--indigo`) and the sidebar hairline (`--card` at 8%). If you prefer named tokens, add `--text-on-indigo-muted` and `--line-on-indigo` to `contracts/tokens.css` and I will switch to them.
- 2026-11-03 — To Rules: Storybook reads `rules/tests/fixtures/findings/r05-example.json` (read only) for the FindingCard stories. Please keep that path, or tell me if it moves.
- 2026-11-03 — To UI-Admin, UI-Review, UI-Partner: register each page by adding `load: () => import('@/<your-folder>/<Page>')` to its entry in `web/src/shell/pages.ts` (default export, no props; read params with `useParams`). Send me the one-line diff or put it in this file and I will apply it, or the Lead may apply it at merge. Set the top bar with `usePageHeader({ title, subtitle, status, actions, crumbs })` from `@/shell/header`; do not render your own h1.
## Data & API

- 2026-11-03 → Lead (compose): mount the reference deals into the api container so the demo seed works there:
  `./docs/dashboard-json:/app/docs/dashboard-json:ro`. Then `docker compose exec api python -m app.seed --reference-publications`
  publishes the 12 real deal objects (partner portals have data before any SetRep is approved). Suggest a `make seed-demo` target.
- 2026-11-03 → Lead (db): I added `db/migrations/002_upload_active_unique.sql` and `003_covenant_threshold_width.sql`.
  002: 001's `unique (deal_slug, collection_period, status)` forbade a second rejected upload for the same period; replaced
  by a partial unique index (one active upload per deal + period). 003: `covenant_definition.threshold numeric(12,6)` overflows
  on SLFA 9.1 (j) Minimum Total Equity = 2,500,000, so `make seed` failed on PostgreSQL; widened to numeric(20,6).
  Both only run on a fresh `pgdata` volume (`make down` first).
- 2026-11-03 → Lead (contract, additive only, please fold into `contracts/openapi.yaml` or tell me to drop them):
  (a) error responses the API returns that the contract does not list: 409 `bad_state` (approve/reject/reextract/override in
  the wrong upload status), 409 `not_open` (override of a resolved finding), 409 `upload_in_progress` (second active upload for
  deal + period), 409 `no_extraction`, 422 `invalid` / `unknown_deal` / `unknown_program` / `unknown_partner` / `not_a_pdf`;
  404 on page image / file when the page or PDF is missing. All errors are `{code, message}` at the top level.
  (b) extra response fields: Upload `reject_reason`; Extraction `pass`, `confidence`, `created_at`; PublishedProgram `program`
  (master record) and `available_periods`; PublishedDeal `published_period`, `available_periods`; PublishedPortfolio is
  `{partner, programs: [program aggregate minus deals + program + available_periods + deals: [{deal_slug, deal_name,
  collection_period, worst_status, covenant_summary, closing_tranche_balance}]]}`; regenerate returns `{queued, programs, publications}`.
  (c) `PUT /master/covenants`: `id` is optional (omit = new definition/version); the contract schema marks it required.
- 2026-11-03 → Rules: on override the API re-runs `rules.run(extraction, ctx, phases=(1, 2))` with a Context it builds itself
  (shape in `api/app/review.py` docstring: prior = last published deal object before the period; master = {program, deal,
  covenants as of the period end}; published_periods; upload = Upload dict). Please confirm `worker/validate` builds the same
  shape and uses the same phases, or tell me yours and I will match it. Note `engine.finding()` sets `extraction_id` to
  `meta.upload_id`; the API overwrites it with the extraction row id, and the worker adapter must do the same.
- 2026-11-03 → Extraction / worker glue: the API expects the worker to (1) set the upload to `extracting` when it takes a
  pass-1 job (the API already sets it for pass 2), (2) insert one `extraction` row per pass with `meta.reporting_period`,
  (3) insert findings with `extraction_id` = that row, (4) set the upload to `needs_review` or `extraction_failed` and fill
  `setrep_upload.reporting_period`. Roll-up ownership: the program aggregate lives in `api/app/rollup.py` (pure function,
  pinned to both real program files) and is computed on read from `publication` rows, so no `worker/publish` is needed.
## Extraction
- RESOLVED 2026-11-03 (extraction, wave 1b: `worker/requirements-dev.txt` has pypdf + pytest) — to Lead: add `pypdf` to `worker/requirements.txt` (or a dev requirements file). Only the seeded-error
  test uses it (it edits one digit in a page content stream); the test skips without it.
- RESOLVED 2026-11-03 by 75884f0 (worker runs `python main.py` from /app) — to Lead: the compose `worker` service mounts `./worker:/app` and runs `python -m worker.main`, but
  the Dockerfile's WORKDIR is `/app`, so there is no `worker` package to import. Either mount at `/app/worker`
  (and keep the command) or change the command to `python main.py`. `worker/main.py` imports work both ways.
- 2026-11-03 — to Lead (docs): `docs/validation-strategy.md` says the three F-PIL servicers use the same 16-page
  template. They do not: Moneda 16 pp, Xpedite 17 pp, Stride 13 pp; the same sections sit on different pages,
  Stride's page 2 is a single NBV portfolio row (no per-advance table, extra "new funded" and "ineligible
  buyback" columns), and Xpedite prints at 2.8 pt with blank cells. The template finds sections by heading and
  picks a layout variant by header keywords; one template covers all three.
- 2026-11-03 — to Lead: the brief's "Done when" says all 12 reference objects; only the 3 F-PIL objects have
  PDFs (the 9 MOVE Trust deals have none). All 3 are reproduced field for field (chaining the 4 reports per deal),
  and each of the 12 PDFs reproduces its own period's rows. MOVE Trust waits for its template and samples.
- 2026-11-03 — to Lead (reference data): two places where the reference objects disagree with each other, so
  no extraction rule can match all three: covenant `legal_ref` is spaced ("SLFA 9.1 (c)") for Moneda and
  Xpedite but not Stride ("SLFA 9.1(d)"), and `source_pages.funding_costs` is null for Stride although page 3
  has the table (heading says "COST OF FUND"). Extraction always spaces the ref and reports the real page.
  Listed in `worker/extract/compare.py: KNOWN_REFERENCE_QUIRKS`. Regenerate the Stride reference if you agree.
- RESOLVED 2026-11-03 by 75884f0 in rules.yaml (R05 identity now has all terms; `npv_adjustment` is named `charge_off`; the Rules agent's checks.py update is pending on agent/rules) — to Rules: R05 (`tranche_rollforward`) uses opening − principal − prepayments − losses. Stride's
  page 2 also has "new funded contracts" (+) and "ineligible buyback" (−); Moneda's has an "NPV adjustment" (−).
  All are zero in the 12 samples, so R05 passes, but a month with new advances will fail. The extraction now
  carries them on the current `period_history` row as `new_funded`, `ineligible_buyback`, `npv_adjustment` (only
  when the layout prints them); please include them in R05 when present.
- RESOLVED 2026-11-03 by 75884f0 (schema field, R18 uses it) — to Rules: every `covenants[]` item carries `reported_triggered` ("YES"/"NO", as printed on the
  quantitative-tests page) for R18's "report's YES/NO must agree with BREACH/not". Moneda May 2026 answers YES
  for SLFA 9.1 (h) and (i) (footnoted historical defaults) while the values derive WATCH/OK: R18 should fire there.
- 2026-11-03 — to Data & API: one upload's extraction carries only its own period in `period_history` and
  `aging_history`, empty `restatements` / `balance_discontinuities`, and `prior_covenants` computed from the
  report's own history (CNL value null: not printed). `worker/extract/history.py: chain(extractions)` builds the
  cross-report fields exactly as the reference objects have them; the publisher (or whoever owns the roll-up)
  can call it with the deal's published extractions plus the approved one. Pass `prior=` to `extract()` to fill
  prior closings and prior CNL from the last published extraction.
- 2026-11-03 — to Data & API: `extraction.meta` carries extra keys (allowed by the schema): `unplaced`, `notes`,
  `model_calls`, `pages_without_text`, `pages_reread`. Pass 2: `worker/main.py: run_job` returns the merged full
  extraction (meta.pass = 2) when the pass-1 file is present; until `worker/validate.handle_extraction(job,
  extraction)` exists, the worker writes `FILE_STORE/uploads/<id>/extraction-pass<n>.json` and stops there.
- 2026-11-03 — to Rules (wave 1b): worker/main.py now calls `mark_extracting(upload_id)` before extracting,
  `handle_extraction(job, extraction)` after writing `extraction-pass<n>.json`, and `mark_failed(upload_id,
  str(exc))` on any exception from either step. It imports them from `validate` (container, cwd /app) or
  `worker.validate` (repo root) and falls back to disk-only when they are missing. For pass 2 the extraction
  handed over is already merged onto pass 1 (meta.pass = 2, meta.pages_reread). Please keep those names and
  signatures; `worker/extract/tests/test_worker_glue.py` pins the call order with fakes.
- 2026-11-03 — to Lead (wave 1b): `worker/requirements.txt` now lists runtime needs only (pdfplumber 0.11.4,
  pypdfium2, pyyaml, jsonschema, anthropic, sqlalchemy, psycopg[binary], redis); pytest moved to
  `worker/requirements-dev.txt` with pypdf. Rules and the agent/rules adapter import nothing beyond these.
  The Dockerfile still installs poppler-utils, which nothing in worker/ uses; drop it if you want a smaller image.
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
