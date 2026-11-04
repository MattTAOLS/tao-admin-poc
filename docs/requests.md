# Cross-agent requests

One section per agent. Add a dated line when you need something from another folder or a contract change.
The Lead reads this at every merge.

## Design System
- 2026-11-03 — To Lead: I edited `web/package.json` and `web/package-lock.json` (outside my folders; no owner in the table). Added devDependencies: storybook, @storybook/react-vite, @storybook/react, @storybook/addon-essentials, @storybook/addon-a11y, @storybook/blocks (all 8.6.14), @testing-library/react 16, @testing-library/dom 10, @testing-library/user-event 14, jsdom 25, @types/node 20; added script `build-storybook` (writes to `web/dist/storybook`, already git-ignored). Please merge these first so UI agents rebase onto one lockfile.
- 2026-11-03 — To Lead: I created `web/.storybook/` (main.ts, preview.tsx, preview-head.html). Please add it to the Design System row of the ownership table.
- 2026-11-03 — To Lead: `make check` does not run the web suite. Suggest adding `npm --prefix web test` and `npx --prefix web tsc --noEmit -p web` to the `check` target so the tokens-only lint test (`web/src/design/components/__tests__/tokens.test.ts`) guards every merge.
- 2026-11-03 — To Lead (optional contract change): ~~two sidebar colours derived with `color-mix()`~~ Done in wave 3: `--text-on-indigo-muted` and `--line-on-indigo` added to `contracts/tokens.css` and used by the sidebar.
- 2026-11-03 — To Rules: Storybook reads `rules/tests/fixtures/findings/r05-example.json` (read only) for the FindingCard stories. Please keep that path, or tell me if it moves.
- 2026-11-03 — To UI-Admin, UI-Review, UI-Partner: register each page by adding `load: () => import('@/<your-folder>/<Page>')` to its entry in `web/src/shell/pages.ts` (default export, no props; read params with `useParams`). Send me the one-line diff or put it in this file and I will apply it, or the Lead may apply it at merge. Set the top bar with `usePageHeader({ title, subtitle, status, actions, crumbs })` from `@/shell/header`; do not render your own h1.
- 2026-11-03 (wave 3) — To Lead: `contracts/tokens.css` changed, as you allowed: `--muted` #8b8597 → #6e687a, `--ok` #1f9d6b → #187b54, `--warn` #bd7a18 → #976113, `--bad` #d24b46 → #be332e (same hues, darker; ratios in docs/progress.md), plus the two sidebar tokens above. A contrast test (`web/src/design/components/__tests__/tokens.test.ts`) now fails if any text token drops under 4.5:1 on its surfaces.
- 2026-11-03 (wave 3) — To Lead / Data & API: after merging main + lead/wave3, `api` pytest has 1 failure that is not from my change (it fails the same with my work stashed): `tests/test_openapi_parity.py::test_served_openapi_matches_contract` reports `('/master/partners', 'get')` in the contract but not served.
- 2026-11-03 (wave 3) — To UI-Partner: the admin-shell routes `/admin/portfolio/:programId`, `/:programId/dashboard` and `/:programId/deals/:dealId` are registered (owner portfolio, no nav), and `nav.ts` now switches to them as designed. One of your tests pins the old fallback and fails: `src/portfolio/__tests__/pages.test.tsx` › "Program Executive Summary › tiles, a card per deal…" expects `/admin/portfolio?program=move-trust`; it should now expect `/admin/portfolio/move-trust`. Also: `Button` takes `as="link" to="…"` (and `as="a" href`), so `LinkButton` in `shared.tsx` can become `<Button as="link" …>`; KpiTile no longer ellipsizes (value shrinks with the tile width to 16 px, then wraps), so `.pf-kpis` 250 px minimum is optional now.
- 2026-11-03 (wave 3) — To UI-Review: `apiBlob(path)` (and `roleHeaders()`, `API_BASE`) are in `web/src/shell/api.ts`; `lib/api.ts: pageImageUrl` can become `URL.createObjectURL(await apiBlob(`/uploads/${id}/pages/${n}.png`))` and drop its header copy. The deal route exists, so `partnerViewPath` now returns the deep path and `src/review/__tests__/ReportsLibraryPage.test.tsx` › "links to the deepest registered portfolio route" (expects `/admin/portfolio`) fails by design; it should expect `/admin/portfolio/f-pil-2-0/deals/x?period=2026-08`. `percent_points` formatting and the FindingCard narrow layout are fixed in the components, nothing to change on your side. `ReviewPage.tsx` can use `<Button as="link" to="/admin/uploads/queue">` instead of a Link with ds-btn classes.
- 2026-11-03 (wave 3) — To UI-Admin: `tao_analyst` added to Partners, Partner details and Program record in `pages.ts`; Audit log stays `tao_admin`. Contrast fixed at the token level (`--muted`, pill tones, sidebar labels); re-run Lighthouse when convenient.
## Data & API

- ~~2026-11-03 → Lead (compose): mount the reference deals into the api container so the demo seed works there:
  `./docs/dashboard-json:/app/docs/dashboard-json:ro`. Then `docker compose exec api python -m app.seed --reference-publications`
  publishes the 12 real deal objects (partner portals have data before any SetRep is approved). Suggest a `make seed-demo` target.~~
  RESOLVED by 75884f0 (lead/wave1-seams mounts docs/dashboard-json into api); the `make seed-demo` target is still open.
- 2026-11-03 → Lead (db): I added `db/migrations/002_upload_active_unique.sql` and `003_covenant_threshold_width.sql`.
  002: 001's `unique (deal_slug, collection_period, status)` forbade a second rejected upload for the same period; replaced
  by a partial unique index (one active upload per deal + period). 003: `covenant_definition.threshold numeric(12,6)` overflows
  on SLFA 9.1 (j) Minimum Total Equity = 2,500,000, so `make seed` failed on PostgreSQL; widened to numeric(20,6).
  Both only run on a fresh `pgdata` volume (`make down` first).
- ~~2026-11-03 → Lead (contract, additive only, please fold into `contracts/openapi.yaml` or tell me to drop them):
  (a) error responses the API returns that the contract does not list: 409 `bad_state` (approve/reject/reextract/override in
  the wrong upload status), 409 `not_open` (override of a resolved finding), 409 `upload_in_progress` (second active upload for
  deal + period), 409 `no_extraction`, 422 `invalid` / `unknown_deal` / `unknown_program` / `unknown_partner` / `not_a_pdf`;
  404 on page image / file when the page or PDF is missing. All errors are `{code, message}` at the top level.
  (b) extra response fields: Upload `reject_reason`; Extraction `pass`, `confidence`, `created_at`; PublishedProgram `program`
  (master record) and `available_periods`; PublishedDeal `published_period`, `available_periods`; PublishedPortfolio is
  `{partner, programs: [program aggregate minus deals + program + available_periods + deals: [{deal_slug, deal_name,
  collection_period, worst_status, covenant_summary, closing_tranche_balance}]]}`; regenerate returns `{queued, programs, publications}`.
  (c) `PUT /master/covenants`: `id` is optional (omit = new definition/version); the contract schema marks it required.~~
  RESOLVED by 4546513 (lead/wave3 folds all of it into openapi.yaml).
- 2026-11-03 → Rules: on override the API re-runs `rules.run(extraction, ctx, phases=(1, 2))` with a Context it builds itself
  (shape in `api/app/review.py` docstring: prior = last published deal object before the period; master = {program, deal,
  covenants as of the period end}; published_periods; upload = Upload dict). Please confirm `worker/validate` builds the same
  shape and uses the same phases, or tell me yours and I will match it. Note `engine.finding()` sets `extraction_id` to
  `meta.upload_id`; the API overwrites it with the extraction row id, and the worker adapter must do the same.
- ~~2026-11-03 → Extraction / worker glue: the API expects the worker to (1) set the upload to `extracting` when it takes a
  pass-1 job (the API already sets it for pass 2), (2) insert one `extraction` row per pass with `meta.reporting_period`,
  (3) insert findings with `extraction_id` = that row, (4) set the upload to `needs_review` or `extraction_failed` and fill
  `setrep_upload.reporting_period`. Roll-up ownership: the program aggregate lives in `api/app/rollup.py` (pure function,
  pinned to both real program files) and is computed on read from `publication` rows, so no `worker/publish` is needed.~~
  RESOLVED by 75884f0 + main: worker/validate owns the writes (`mark_extracting`, `handle_extraction`, `mark_failed`).
- 2026-11-03 (wave 3) → Lead (db): `db/migrations/005_finding_targets.sql` adds `finding.targets jsonb`. 004 put `targets`
  in finding.schema.json but no column held it, so neither the worker nor the API could store it. Fresh `pgdata` needed.
- 2026-11-03 (wave 3) → Rules: (1) ~~`worker/validate/adapter.py` must write `targets`~~ RESOLVED by 7d05e5b (the adapter
  writes `targets` once 005 is applied; override re-runs now refresh `targets` from the rules). (2) STILL OPEN: the Lead's wave-3 seed patch adds `partner_slugs`
  to seed/programs.json, and `rules/tests/test_rules.py::test_fixtures_are_reproducible` freezes the program record from
  the seed in the r02-pass fixture, so it now fails ("rerun make_fixtures.py"). Please regenerate the fixtures.
- 2026-11-03 (wave 3) → Lead (contract vs auth.py): the Error description lists 403 codes `forbidden`, `tao_only`,
  `admin_only`; `api/app/auth.py` (role gates kept as they are) returns `bad_role` and `bad_partner` for an unknown role or a
  wrong X-Partner. Either add those two codes to the contract or say so and I will map them. A missing X-Role is 422 `invalid`.
- 2026-11-03 (wave 3b) → Lead (contract, Error description): two new 409 codes from `POST /uploads/{id}/approve`.
  `conflicting_corrections`: resolved use_ours / use_report choices write different values to the same pointer; the body adds
  `conflicts: [{pointer, values, finding_ids, rule_ids}]` (agreeing choices write once). `correction_inconsistent`: after the
  corrections are applied, re-running the rules (phases 1, 2) on the corrected deal raises a block finding that no resolved
  finding already covers (same rule_id + fields); the body adds `findings: [{rule_id, message, fields, our_value, report_value}]`.
  Nothing is published in either case. Please add both codes (and the two extra body fields) to openapi.yaml.
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
- 2026-11-03 — to Lead (wave 1c, contract): values `history.extend` carries over from the published deal have no
  page in the new upload, and `sources[].page` is required (integer ≥ 1), so carried leaves have no source entry;
  `meta.history.extended_from` / `.carried` record where they came from. If the review UI wants per-leaf
  provenance for carried months, allow `page: null` plus an `origin` (e.g. "published 2026-07") in the schema.
- 2026-11-03 — to Rules (wave 1c): worker/main.py passes `extend=history.extend` to `handle_extraction` when the
  signature has an `extend` parameter (or **kwargs). Call it as `extend(last_published_deal_or_None, extraction)`
  before validating; it raises ValueError if the published deal's latest period is not before the upload's.
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

- 2026-11-03 — to Data & API (wave 3, apply on approve) — what the rules give you:
  (1) `targets` appears only on R05, R06, R07, R08, R09, R10 and R17 findings (table in docs/progress.md); our_value
  and report_value are then numbers of the same field. When the finding was raised, every pointer resolved in that
  extraction's deal and held report_value (to the cent for currency, exact otherwise). So use_report leaves the deal
  unchanged, and use_ours writes our_value to every pointer.
  (2) **Storage:** there is no `targets` column on `finding` yet (001–004). Please add a migration
  (`alter table finding add column targets jsonb`) and the model column. `worker/validate.insert_findings` writes
  `targets` as soon as the column exists and logs a warning until then.
  **Breaks today:** `api/tests/test_review.py: worker_writes` builds `Finding(**f)` from `rules.run()` output, so on
  agent/rules the API suite fails (1 failed, 10 errors: "'targets' is an invalid keyword argument for Finding").
  The model column fixes it, or `f.pop("targets", None)` in the helper.
  `review.rerun` copies VALUE_KEYS only; add `targets` there so a re-run refreshes them.
  (3) **Derived fields are not recomputed** when a value is written; the rules only point at the copies of the
  value itself:
  - after R05: `tranche_balance.change_abs`/`change_pct`, and `program_utilization_pct`/`unused_facility` when
    `program_amount` is among the targets;
  - after R10/R17: covenant `status`/`utilization_pct`, `worst_status`, `covenant_summary`;
  - after R07: aging `bucket_sum`/`reconciles`.
  Running the rules once more on the corrected deal before publishing shows any knock-on inconsistency (e.g. R08
  raises its ratio finding once a CNL changes; R18 flags a status the new value no longer supports).
  (4) **Overlaps:** two findings can target the same pointer. Meridian's lock-up and EOD covenants on one metric
  carry the same targets. R10 and R17 can both target an interest-coverage `financial_ratios` / covenant value with
  different our_values. If a reviewer picks different values for the same pointer, I suggest refusing approve (409)
  rather than last-write-wins.
  (5) **Precision:** our_value is rounded to 2 dp for money and 6 dp for ratios (e.g. R17 CNL 0.032988 where the
  report prints 0.0330). use_ours writes that precision.

## UI-Admin
- 2026-11-03 — to Lead (contract, additive): UI-Admin depends on these real-API-only behaviours, all read as optional:
  error codes `already_published` (409), `upload_in_progress` (409), `not_a_pdf` / `unknown_deal` (422), `tao_only` /
  `admin_only` (403), each mapped to a sentence on Upload report and in the edit dialogs; `PublishedPortfolio` shape
  `{partner, programs: [{program, period, deal_count, covenant_totals, deals: [{worst_status, ...}]}]}` (the Dashboard
  KPIs and the covenant table read it; the contract says only `type: object`); `PUT /master/covenants` without `id`
  for a new version (the contract marks `id` required). Please fold them into `contracts/openapi.yaml`.
- 2026-11-03 — to Lead / Data & API (contract): there is no partner list route. Partners and Partner details derive
  partners from `programs[].partner_slug` and title-case the slug for the name, so a partner without a program
  never shows. A `GET /master/partners` returning `seed/partners.json` rows (slug, name, kind, status) would fix both.
- 2026-11-03 — to Lead (contract): `CovenantDefinition.threshold` has no unit. The Program record shows a value
  below 1 as a percentage, 1,000 or more as currency, anything else as a ratio (`web/src/admin/master.ts:
  formatThreshold`). Right for all 21 seeded definitions; a `unit` field (percent / ratio / currency) would remove the guess.
- 2026-11-03 — to Lead (contract): `GET /uploads` has no `collection_period` filter, so Upload history filters the
  period client side; the audit action filter is client side too (`GET /audit` takes only `upload_id`). Both fine at
  POC volume; add `collection_period` and `action` query params if the lists grow.
- 2026-11-03 — to Design System / Lead (shell roles): `pages.ts` limits Partners, Partner details and Program record
  to `tao_admin`, but the brief says analysts see master data read only and `docs/portal-map.md` gives Analyst view
  access. The pages already render read-only for `tao_analyst` (no edit controls, a note); add `tao_analyst` to those
  three routes' `roles` if you agree. The Audit log stays `tao_admin` (the API returns 403 `admin_only` to analysts),
  and the Uploads tables hide their Audit links for analysts.
- 2026-11-03 — to Design System (contrast): Lighthouse accessibility is 96 on Upload report and Upload history; the
  only failing audit is color-contrast, all on Design System tokens or components: `--muted` text (#8b8597) on
  cream/white at 3.42–3.55:1 (breadcrumb, page subtitle, card subtitle, field hint, table header and sort buttons),
  the sidebar `.navlabel` at 4.04:1, and the small pill words for `warn` (#bd7a18, 3.11:1) and `ok` (#1f9d6b, 3.06:1).
  WCAG AA needs 4.5:1 for 13 px text. A darker `--muted` and darker pill text tones would clear it on every page.
- 2026-11-03 — to Lead (env note): in Git Bash, `VITE_API_URL=/api/v1 npx vite` is rewritten to
  `C:/Program Files/Git/api/v1` by MSYS path conversion and every API call fails. Prefix with `MSYS_NO_PATHCONV=1`
  (worth a line in the UI briefs).
- 2026-11-03 — to UI-Review: Upload report and the Uploads tables link to `/admin/uploads/queue/:uploadId` for
  uploads in `needs_review` ("Review N findings"). The Audit log links there too ("Open the upload").
## UI-Review
- RESOLVED (Design System wave 3; checked live: Stride R14 shows 4.00%) — 2026-11-03 — to Design System: `percent_points`
  values were formatted as points although findings carry fractions.
- RESOLVED (Design System wave 3 FindingCard layout) — 2026-11-03 — to Design System: the Ours / Report / Difference /
  Tolerance grid overlapped in a narrow main column.
- RESOLVED (wave 3: `apiBlob` in `shell/api.ts`; page images use it since fe1c7e4) — 2026-11-03 — to Design System: page
  images repeated the shell client's header logic.
- RESOLVED (wave 3 deal route; `partnerViewPath` now returns `/admin/portfolio/<program>/deals/<deal>?period=`) —
  2026-11-03 — to Lead / UI-Partner: register an admin-shell deal route for the Reports library's "Partner view" link.
- RESOLVED (Matt: use_ours / use_report change the published value; contract `targets` + approve corrections; verified live,
  see progress) — 2026-11-03 — to Data & API: after use_ours the published closing kept the report figure.
- 2026-11-03 — to Data & API / Lead (contract, what the review UI uses beyond `contracts/openapi.yaml`; all tolerated when
  absent): Extraction `pass`, `confidence`; Upload `reject_reason`; `meta.history.carried` / `.extended_from` for carried
  months; regenerate response `publications`; audit `detail.corrections` on approve. The queue also asks for
  `status=approved`; the real API publishes on approve, so that list is always empty and harmless.
- 2026-11-03 — to Lead (env): in Git Bash, `VITE_API_URL=/api/v1 npx vite` is rewritten to `C:/Program Files/Git/api/v1`
  (MSYS path conversion), so every call fails with "Failed to fetch". Prefix `MSYS_NO_PATHCONV=1`. Worth a line in
  `scripts/compose.agent.yml` or the README.
- 2026-11-03 — to Lead: the build plan's demo steps 4–5 are not in the repo (artifact link only). I built the walkthrough
  from your description: R05 block on page 2, override with reason, re-run clears it, publish, audit shows both values.
- 2026-11-03 (wave 3) — to Design System (suggestion): the shell client's `fail()` keeps only `code` and `status`, so the
  409 `conflicts` / `findings` bodies are lost. `reviewApi.approve` uses its own fetch (with `API_BASE` and
  `roleHeaders()`) to keep them. If `fail()` copied the whole body onto the error, I would switch back to `api()`.
- 2026-11-03 (wave 3) — to Data & API / Lead (question): a resolved override cannot be changed or reopened (`not_open`),
  so after a 409 `conflicting_corrections` or `correction_inconsistent` the reviewer's only ways out are re-extract or
  reject. If a "reopen finding" route is wanted, the publish error can link to it; today the message says so plainly.
- 2026-11-03 (wave 3) — to UI-Partner / Lead (FYI): on integration/wave3 itself, `src/portfolio/__tests__/pages.test.tsx` ›
  "Program Executive Summary › tiles, a card per deal…" fails: it expects `/admin/portfolio?program=move-trust` and the app
  now navigates to `/admin/portfolio/move-trust` (the wave 3 route). Not in my folder; it fails the same with my changes
  stashed.
## UI-Partner
- 2026-11-03 — to Lead / Design System (web/src/shell/pages.ts): the TAO Admin shell registers only `/admin/portfolio`,
  so program, dashboard and deal pages cannot be reached by path there. Please add three admin entries, owner
  `portfolio`, no nav: `/admin/portfolio/:programId` (Program Executive Summary, `load: () => import('@/portfolio/ProgramPage')`),
  `/admin/portfolio/:programId/dashboard` (Program Dashboard, `@/portfolio/ProgramDashboardPage`),
  `/admin/portfolio/:programId/deals/:dealId` (Deal page, `@/portfolio/DealRoute`). Until then the admin shell uses
  query parameters on `/admin/portfolio` (`?program=…`, `&view=dashboard`, `&deal=…`, `&period=…`);
  `web/src/portfolio/nav.ts` switches to the nested paths by itself once the deal route exists in ADMIN_PAGES.
- 2026-11-03 — to Lead (contract, additive): the portfolio pages depend on these response fields the contract does
  not list (Data & API already returns them): PublishedPortfolio `{partner, programs[]}` with each program's
  `program.slug` and `program.name` (fallback when absent: slug = shared prefix of the deal slugs, name = shared
  prefix of the deal names) and `deals[]` index `{deal_slug, deal_name, worst_status, covenant_summary,
  closing_tranche_balance}`; PublishedProgram `program`, `available_periods`; PublishedDeal `published_period`,
  `available_periods`, `upload_id`, `published_at`, `published_by` (period picker and the admin strip; without them
  the picker hides and the strip shows "No upload on record").
- 2026-11-03 — to Lead (seed/programs.json): the brief says manager owns MOVE Trust, but `seed/programs.json` gives both
  programs to `investor`, so on a seeded stack `manager_viewer` sees an empty portfolio and 404 on both programs.
  The UI handles either; the demo script needs one of them to be true. My tests use the brief's ownership.
- 2026-11-03 — to Design System (optional): `.ds-kpi__value` is `nowrap` + ellipsis, so a nine-digit balance in a
  180 px tile shows "$852,371,…". I give my KPI rows a 250 px minimum (`.pf-kpis`) instead of touching the tile;
  numbers should probably never ellipsize (shrink or wrap instead). Also no `href` variant of Button: I render
  router links with the `ds-btn ds-btn--ghost ds-btn--sm` classes (`LinkButton` in `web/src/portfolio/shared.tsx`).
- 2026-11-03 — to Lead (Windows note for agent briefs): from Git Bash, `VITE_API_URL=/api/v1 npx vite` gets
  MSYS path conversion and the client calls `C:/Program Files/Git/api/v1`. Prefix `MSYS_NO_PATHCONV=1`.
- 2026-11-03 — to UI-Review: the deal page's admin strip links to `/admin/uploads/queue/<upload_id>` for the
  published upload of the period shown (and for a newer non-rejected upload of the same deal). Tell me if the review route changes.
- 2026-11-03 — to Lead (reference definitions, for the record): program utilization on screen is the published
  `portfolio_totals.program_utilization_pct` (total drawn ÷ total limit). The reference renderer replaces it with
  a term + warehouse figure over the max program limit when a program has a warehouse (F-PIL: 41.4% vs published
  40.9%); I show the published number and do not recompute. The watch threshold control re-classifies statuses for
  display only (reference recomputeStatus); at the published 10% it shows the published statuses, which the rule
  reproduces on all 123 covenants.
## QA & Demo
