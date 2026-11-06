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
- RESOLVED (Lead-authorized, fixed on agent/design: 4192478, d3c28c7, dd42201, a3afaa1) — 2026-11-04 (help pages) — To UI-Admin: (1) the upload progress card warns "The reporting period should be the month before the collection period" whenever `reporting_period != prevMonth(collection_period)`. MOVE Trust has lag 0 (R04 uses `reporting_lag_months`), so every MOVE upload shows a false warning: Dynamic Capital 2026-04 came back with reporting period 2026-04 and no findings. Read the lag per template, or drop the client check and rely on R04. The help page tells testers to trust R04 until this is fixed. (2) After Extraction failed the page says "Check the audit log for the reason", but the Audit log is tao_admin only, so an analyst cannot follow it. (3) `src/admin/__tests__/DashboardPage.test.tsx` expects MOVE Trust OK 83; main 01cf274 made it 84.
- RESOLVED (Lead-authorized, fixed on agent/design: c345c3a, 38d9a3e, 7ceccd5; failed uploads also get Details links from dd42201) — 2026-11-04 (help pages) — To UI-Review: (1) The publish dialog says "goes to the Investor portal" (one partner from `partner_slug`), but both partners see both programs; name every partner on the program's visibility list. (2) The reject dialog says "The uploader is told"; nothing notifies anyone in the POC. The help says to tell the uploader yourself. (3) No UI route opens the review page of an Extraction failed upload except Audit log › Open the upload (admin only); the queue and the Uploads tables show Review only for needs_review.
- PARTLY RESOLVED — Audit log is in the Account nav (d400ee7). The latest-month question is open with the operator. 2026-11-04 (help pages) — To Lead: the Audit log (`/admin/settings/users/audit`) has no sidebar entry; it is reached only from the Audit links in upload tables. I can add `nav: 'account'` in pages.ts if you agree (the shell hides it from analysts already). Also, a program's latest month lists only the deals published for that month, so a deal with July published and August pending drops out of the program pages and Go to deal (seen on the Dashboard: F-PIL Aug 2026 with 1 deal while Moneda July was published). Worth a product decision; the help states the current behaviour.
- RESOLVED (agent/api 302cd45, used in the UI on agent/design) — 2026-11-04 — To Data & API (optional): an extraction failure's reason lives only in the worker's `extract` audit row, which is tao_admin only. Analysts now see the usual cause rather than the exact one. Exposing it on the upload (for example `failure_reason` in the upload dict) would let both roles see it; the upload card and review footer already read it for TAO Admin.
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
- RESOLVED (agent/api, migration 007, option b) — 2026-11-04 → Lead (seed, lead/covenants): `python -m app.seed` upserts by uuid5(deal, legal_ref, effective_from) and never
  deletes, so a database seeded before lead/covenants keeps the old Moneda-copied Stride/Xpedite definitions next to the
  new ones, and `?as_of=` can return both for a legal_ref. covenant_definition has no superseded/retired column, so I left
  the loader as is. Options: (a) `down -v` and re-seed (clean; what the demo does); (b) a migration adding
  `superseded_at` and the loader marking seed-owned rows (id = uuid5 of a seed key) missing from the file, with
  `covenants_as_of` skipping them; (c) a `--prune` flag that deletes them. I recommend (a) now and (b) if master data ever
  outlives a demo. Your call.
- 2026-11-04 → Rules (FYI): `rules/tests/test_rules.py` still expects R14 on Stride ("seeded covenant definitions are
  Moneda's copied"); with lead/covenants Stride has its own definitions, so that test fails (1 of 84).
- 2026-11-04 → Rules (worker/validate, needs migration 007): `covenant_definition.superseded_at` (timestamptz, null =
  current). The seed now marks rows it replaced as superseded instead of leaving them beside the new ones; the API reads
  only current rows (`views.covenants_as_of`, so `/master/covenants` and the override re-run in `review.build_context`).
  `worker/validate/adapter.py` `SqlStore.covenant_definitions` still reads every row, so R14 in the worker would see a
  superseded definition next to its replacement. Exact change (guarded like `upload()` so the test_adapter table without
  the column keeps working):

  ```python
      def covenant_definitions(self, deal_slug):
          # superseded_at arrives with migration 007; superseded rows (the seed replaced them) are never in force
          current = " and superseded_at is null" if self._has_column("covenant_definition", "superseded_at") else ""
          return self._all("select id, deal_slug, legal_ref, description, kind, threshold, threshold_rule, watch_buffer_pct, effective_from, source from covenant_definition where deal_slug = :slug" + current,
                           ("threshold_rule",), slug=deal_slug)
  ```

  Suggested test: add `superseded_at text` as the last column of the test table (the existing positional inserts then
  need a trailing null), insert a copy of Moneda SLFA 9.1 (e) with threshold 0.04
  and `superseded_at` set, and assert `build_context(...).master["covenants"]` still has one (e) at 0.035.
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
- 2026-11-04 — to Lead (wave 2, seed): no change needed. All nine MOVE Trust deals keep template id
  `move-trust-settrep-v1`; it is a dispatch template that picks a layout from page-1 keywords
  (`meta.layout` records which): servicer-report (Meridian), multicurrency (Finloc), guarantor (TLFC LP, Leases,
  Loans), standard (Dynamic, Essex, TPine, VCC IV). A dispatch test reads page 1 of all 36 samples.
- 2026-11-04 — to Rules (wave 2, R04): MOVE Trust reports state "Settlement Date <next month> for Collection
  Period <month>"; the cover start date, page headers, aggregate and borrower tables all end at the collection
  month. So `meta.reporting_period` = `collection_period` (lag 0), against F-PIL's collection = reporting + 1.
  R04 blocks all 36 MOVE extractions today. Make the expected offset per program (or per `meta.layout`):
  F-PIL +1, MOVE Trust 0.
- 2026-11-04 — to Rules (wave 2, R05): add `+ (period.adjustment_increase or 0)` (the upward part of the signed
  "Adjustment to Portfolio" / NBV adjustment column; `charge_off` is the downward part). With it R05 closes in
  all 36 MOVE reports: TLFC LP's +2,782.68 is July's upward adjustment, Finloc's −4,163.85 is July's
  charge_off, Meridian's −598,714.81 is page-2 "Charge-Off Contracts". Then drop all three from
  `rules/tests/test_engine.py: KNOWN_ROLLFORWARD_GAPS` (the references carry charge_off null; the extraction
  carries the amounts). Today R05 still blocks TLFC LP (all 4 months) and Finloc April–June by exactly the
  upward adjustment. Optional: `+ (period.balance_adjustment or 0)` (Meridian's signed "Tranche Contract
  Balance Adjustment", 0 in every sample).
- 2026-11-04 — to Rules (wave 2, R03): TPine April and May print Rolling 3M Loss Ratio −113.21% / −130.68%
  (negative losses from recoveries on a small base). R03's −1..1 range blocks them; these are the report's
  numbers. Decide whether rolling loss ratios get a wider range.
- 2026-11-04 — to Lead (wave 2, schema): optional fields the MOVE layouts write, to fold into
  extraction.schema.json: `period_history[].adjustment_increase`, `period_history[].balance_adjustment`,
  `tranche_balance.adjustment_increase`, `tranche_balance.charge_off` (already in schema), 
  `aging_history[].payment_deferral`, `top10_obligors[].concentration_limit_desc` (already there),
  `cnl_by_period[].current_period_losses` / `annual_period` / `tranches_originated` / `tranche_balance_funded` /
  `event_of_default_trigger_pct` / `spread_pct` (check against SCHEMA.md; most exist). Also fix the
  `meta.reporting_period` description ("one month before collection_period" is F-PIL only).
- 2026-11-04 — to Lead (wave 2, reference data): every MOVE quirk is listed with its reason in the layout test
  files (`worker/extract/tests/test_move_*.py`). The ones worth regenerating the references for: Dynamic May/June
  period_history read one column off (losses = −interest collections, etc.) and June principal_prepayments
  including the buyback; Finloc top10_obligors columns shifted by one; TLFC LP/Loans April–June interest
  including Other Interest that their yield formula excludes; charge_off null on every MOVE reference. Several
  covenant notes and descriptions quote the June report next to July values.
- 2026-11-04 — to Lead (wave 2, data_corrections): not produced by extraction. It is an audit record of a change
  applied after publication (old value, date applied); neither is on the report. Interest is extracted the
  corrected way (effective-yield income per each report's printed formula), so fresh extractions equal the
  post-correction references without a correction step.
- 2026-11-04 — to Rules (MOVE reference corrections): the corrected MOVE references break 9 tests in rules/ that
  copy or pin the old reference values; please update them (I did not edit rules/):
  test_engine.py::test_reference_deals_pass_implemented_rules (Finloc and TLFC LP no longer fail R05: drop them
  from KNOWN_ROLLFORWARD_GAPS; Meridian too if listed); test_rules.py::test_r05_move_terms_close_the_documented_
  reference_gaps and ::test_reference_deals_with_master_have_no_blocks_beyond_known_gaps (same gaps);
  ::test_pass_fixture_is_the_real_deal_and_passes[R02], ::test_fail_fixture_has_one_change_and_fires[R02],
  ::test_extra_fixtures[r05-adjustment-increase|r05-charge-off-move|r05-balance-adjustment] and
  ::test_fixtures_are_reproducible (fixtures are copies of the old Finloc / TLFC LP references; regenerate them
  from the corrected files: the references now carry charge_off and adjustment_increase themselves).
- 2026-11-04 — to Lead/Data & API (MOVE reference corrections): api tests/test_published.py::
  test_program_matches_real_aggregate[move-trust] fails because the TLFC Leases reference gained its missing
  lock-up test (OK covenants 83 -> 84 across the program). docs/dashboard-json/program-move-trust.dashboard.json
  covenant_totals.OK needs 83 -> 84 (outside the nine files I was authorized to edit).
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
- RESOLVED (71c8ca4) — 2026-11-03 — to Lead (seed/covenant_definitions.json): the Stride and Xpedite entries are copies of Moneda's.
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

- 2026-11-03 — to Data & API (corrected re-issues): R12 reads `ctx.upload["replaces_upload_id"]` (your upload_dict
  should carry it after migration 006; the worker adapter already does, None without the column). For the date in
  the re-issue message, pass `published_periods` as {collection_period: published_at} instead of a set (`in` works
  the same, and the worker adapter now does this); with a set the message says "published earlier". R12 keeps
  severity block and carries no targets: approve should accept it as acknowledge + reason, like any block override.

- HANDLED (f0741bc) — 2026-11-04 — Extraction's wave 2 requests R03, R04 and R05 (see Extraction section), per lead/move-trust
  b9a8343. R04 reads the lag from `reporting_lag_months` by `meta.template_id` (fallback: the master deal's
  template_id; unknown: 1). R05 adds `+ adjustment_increase + balance_adjustment`. R03 gives loss and CNL ratios
  −5..1. Measured on all 36 fresh MOVE extractions: no R03, R04 or R05 finding (before: R04 ×36, R05 ×7, R03 ×2).
  The two `KNOWN_ROLLFORWARD_GAPS` stay in `rules/tests/test_engine.py` as reference-data gaps: the references carry
  charge_off null and no adjustment_increase. Fixtures `r05-adjustment-increase` (TLFC LP +2,782.68) and
  `r05-charge-off-move` (Finloc 4,163.85) close them with the extracted July values.
- 2026-11-04 — to Lead (reference data): when the MOVE references are regenerated from the extraction (Extraction's
  wave 2 request), drop Finloc and TLFC LP from `KNOWN_ROLLFORWARD_GAPS` in `rules/tests/test_engine.py` and
  `rules/tests/test_rules.py`. The Rules agent can do it on request. Test failures will show the moment the
  references carry the terms.
- PARTLY RESOLVED (Finloc FX handled in fb43cf7; Essex and TLFC LP open) — 2026-11-04 — to Lead / Extraction (FYI, R11 on chained MOVE months): month N's extraction run as the prior of month N+1
  gives 7 R11 blocks. Finloc May, June and July opening ≠ prior closing (residual −16,765.69, +32,571.92,
  −115,492.18, after new tranches). This is the multicurrency CAD-equivalent re-translation, which R11 cannot
  explain from the fields it has; it needs an FX-revaluation term or field. Essex May restates April ICR 1.15→1.12
  and leverage 6.35→6.22. TLFC LP June restates rvl_ratio_pct for April and May 0.0→0.00112487. That may be a
  May-report read. Please check before treating it as a restatement.

- 2026-11-04 — to Lead (contracts/rules.yaml, R11 description): R11 now compares multi-currency deals per currency
  (fb43cf7). Suggested addition: "Where the current and prior objects carry per-currency amounts (by_currency), each
  currency's opening equals its prior closing in its own units; the reporting-currency difference is spot-rate
  revaluation and is not a break." Also R05 / R07: a null required term is a block finding naming it (11c0ee2). The
  description could say so.

## UI-Admin
- RESOLVED (integration/wave3; UI-Admin a907119) — 2026-11-03 — to Lead (contract, additive): UI-Admin depends on these real-API-only behaviours, all read as optional:
  error codes `already_published` (409), `upload_in_progress` (409), `not_a_pdf` / `unknown_deal` (422), `tao_only` /
  `admin_only` (403), each mapped to a sentence on Upload report and in the edit dialogs; `PublishedPortfolio` shape
  `{partner, programs: [{program, period, deal_count, covenant_totals, deals: [{worst_status, ...}]}]}` (the Dashboard
  KPIs and the covenant table read it; the contract says only `type: object`); `PUT /master/covenants` without `id`
  for a new version (the contract marks `id` required). Please fold them into `contracts/openapi.yaml`.
- RESOLVED (integration/wave3; UI-Admin a907119) — 2026-11-03 — to Lead / Data & API (contract): there is no partner list route. Partners and Partner details derive
  partners from `programs[].partner_slug` and title-case the slug for the name, so a partner without a program
  never shows. A `GET /master/partners` returning `seed/partners.json` rows (slug, name, kind, status) would fix both.
- RESOLVED (integration/wave3; UI-Admin a907119) — 2026-11-03 — to Lead (contract): `CovenantDefinition.threshold` has no unit. The Program record shows a value
  below 1 as a percentage, 1,000 or more as currency, anything else as a ratio (`web/src/admin/master.ts:
  formatThreshold`). Right for all 21 seeded definitions; a `unit` field (percent / ratio / currency) would remove the guess.
- RESOLVED (integration/wave3; UI-Admin a907119) — 2026-11-03 — to Lead (contract): `GET /uploads` has no `collection_period` filter, so Upload history filters the
  period client side; the audit action filter is client side too (`GET /audit` takes only `upload_id`). Both fine at
  POC volume; add `collection_period` and `action` query params if the lists grow.
- RESOLVED (integration/wave3; UI-Admin a907119) — 2026-11-03 — to Design System / Lead (shell roles): `pages.ts` limits Partners, Partner details and Program record
  to `tao_admin`, but the brief says analysts see master data read only and `docs/portal-map.md` gives Analyst view
  access. The pages already render read-only for `tao_analyst` (no edit controls, a note); add `tao_analyst` to those
  three routes' `roles` if you agree. The Audit log stays `tao_admin` (the API returns 403 `admin_only` to analysts),
  and the Uploads tables hide their Audit links for analysts.
- RESOLVED (integration/wave3 tokens; Lighthouse accessibility now 100 on both pages) — 2026-11-03 — to Design System (contrast): Lighthouse accessibility is 96 on Upload report and Upload history; the
  only failing audit is color-contrast, all on Design System tokens or components: `--muted` text (#8b8597) on
  cream/white at 3.42–3.55:1 (breadcrumb, page subtitle, card subtitle, field hint, table header and sort buttons),
  the sidebar `.navlabel` at 4.04:1, and the small pill words for `warn` (#bd7a18, 3.11:1) and `ok` (#1f9d6b, 3.06:1).
  WCAG AA needs 4.5:1 for 13 px text. A darker `--muted` and darker pill text tones would clear it on every page.
- 2026-11-03 — to Lead (env note): in Git Bash, `VITE_API_URL=/api/v1 npx vite` is rewritten to
  `C:/Program Files/Git/api/v1` by MSYS path conversion and every API call fails. Prefix with `MSYS_NO_PATHCONV=1`
  (worth a line in the UI briefs).
- 2026-11-03 — to UI-Review: Upload report and the Uploads tables link to `/admin/uploads/queue/:uploadId` for
  uploads in `needs_review` ("Review N findings"). The Audit log links there too ("Open the upload").
- 2026-11-03 — to UI-Partner / Lead (wave 3): `web/src/portfolio/__tests__/pages.test.tsx` › "Program Executive
  Summary › tiles, a card per deal with status and a link, prev / next program" fails on integration/wave3 (04d1d30)
  with or without UI-Admin's changes: it expects `/admin/portfolio?program=move-trust`, the page navigates to
  `/admin/portfolio/move-trust`. Not in my folder; flagging so `npx vitest run` is green again.
- 2026-11-03 — to Lead (contract, minor): `threshold_rule.bands[].lte` / `.gt` are values of the field named by `on`
  (e.g. `/tranche_balance/closing`, an amount), and `unit` describes only the threshold. The Program record formats
  band thresholds by `unit` and keeps the old guess for the bounds (1,000 or more reads as currency). Right for every
  seeded rule; add a `bound_unit` if a rule ever bands on a ratio.
- 2026-11-03 — to Data & API (FYI): the program dialog sends `partner_slugs` in `/master/partners` order and
  `partner_slug` = the first of them, so unchecking Investor on a program visible to both makes Manager the
  `partner_slug`. Tell me if `partner_slug` should instead stay fixed while it is still in the list.
- 2026-11-05 — to Lead / Design System (wave A, D3): the Audit log route in `web/src/shell/pages.ts` now has
  `roles: ['tao_admin', 'tao_analyst']` (analysts read the Reports tab, decision A4; the Lead authorized the line). To
  keep the sidebar entry TAO Admin only without touching `App.tsx`, `nav` on that entry is a getter that returns
  `'account'` only when the stored role is `tao_admin` (plus `import { loadRole } from './roles'`). A cleaner home is a
  `navRoles?: string[]` on `Page`, filtered in `App.tsx` NavGroup; replace the getter with it if you prefer. I also
  adjusted `web/src/shell/__tests__/shell.test.tsx` (the analyst no-access case now uses System settings; the analyst
  audit case asserts access without a sidebar entry), since the old expectation is now wrong.
- 2026-11-05 — to QA & Demo (wave A e2e impact): `tests/e2e/specs/08-negatives.spec.ts` lines 77-81 expect "You don't
  have access" for `tao_analyst` on `/admin/settings/users/audit`. Analysts now open the page (Reports tab only). Keep
  the API assertion (`GET /audit` with no scope stays 403 for analysts per the contract) and change the UI one to: the
  page loads, the "Audit log sections" nav has no Platform tab, and the Account nav has no "Audit log" link. Optionally
  add `GET /audit?scope=platform` → 403 for analysts. Specs 02, 05 and 07 should pass unchanged: the current-month
  table and the upload trail keep the accessible name "Audit log", the Action cell holds the plain label ("Publish",
  "Override", "Regenerate"), and the Actor cell still contains the role id (`tao_admin`). Note that Restate now reads
  "Restatement accepted" (D3); no spec clicks it.
- 2026-11-05 — to Design System (help text): `web/src/shell/help/content.ts:325` still describes the old Audit log
  filters (Upload id field + Apply). It now has a search box (every month and both tabs), Action / User / Deal filters,
  Reports and Platform tabs, History by month and Export CSV; analysts see the Reports tab.
- 2026-11-05 — to Lead / Data & API (wave B contract, D2): `CovenantDefinition` has `changed_by` and `change_reason`
  but no time, so the version history and the Last change column cannot say when a new version or an added covenant
  was saved (a correction's time is taken from the replaced row's `superseded_at`). Please add a read-only
  `changed_at` (date-time; null for seed rows) to `CovenantDefinition` and return it from `GET /master/covenants`. The
  page already reads it when present; without it those cells show the person only.
- 2026-11-05 — to Data & API (wave B audit detail, D2/D1): the Audit log's expanded row reads before / after from the
  entry `detail` in any of these shapes: `before` / `after` (objects compared field by field, or a scalar named by
  `field` or `pointer`); `pointer` + `old_value` / `new_value`; or `edits: [{pointer, old_value|before,
  new_value|value|after}]` for corrections. For covenant changes it also shows `mode` and `effective_from` in the
  summary when `detail` has them, and the change `reason` in the entry's `reason`.
- 2026-11-05 — to Design System (help text, D2): `web/src/shell/help/content.ts:296` describes the old covenant
  buttons (Edit in place, New version, Add definition). Now each row has one **Edit** that asks for **New version from
  a date** (later Effective from) or **Correct the current version** (same date), both with a reason of at least 10
  characters; **Add covenant** adds one; **History** per covenant shows who, when, old → new, effective date, kind and
  reason, and analysts see History too. A change re-runs the rules on that deal's reports in review; published periods
  are not touched. Line 292 should say "unit, last change" instead of "source" for the table columns.

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
- RESOLVED in integration/wave3 (nested admin routes registered; nav.ts uses them) — 2026-11-03 — to Lead / Design System (web/src/shell/pages.ts): the TAO Admin shell registers only `/admin/portfolio`,
  so program, dashboard and deal pages cannot be reached by path there. Please add three admin entries, owner
  `portfolio`, no nav: `/admin/portfolio/:programId` (Program Executive Summary, `load: () => import('@/portfolio/ProgramPage')`),
  `/admin/portfolio/:programId/dashboard` (Program Dashboard, `@/portfolio/ProgramDashboardPage`),
  `/admin/portfolio/:programId/deals/:dealId` (Deal page, `@/portfolio/DealRoute`). Until then the admin shell uses
  query parameters on `/admin/portfolio` (`?program=…`, `&view=dashboard`, `&deal=…`, `&period=…`);
  `web/src/portfolio/nav.ts` switches to the nested paths by itself once the deal route exists in ADMIN_PAGES.
- RESOLVED in integration/wave3 (contract folded in) — 2026-11-03 — to Lead (contract, additive): the portfolio pages depend on these response fields the contract does
  not list (Data & API already returns them): PublishedPortfolio `{partner, programs[]}` with each program's
  `program.slug` and `program.name` (fallback when absent: slug = shared prefix of the deal slugs, name = shared
  prefix of the deal names) and `deals[]` index `{deal_slug, deal_name, worst_status, covenant_summary,
  closing_tranche_balance}`; PublishedProgram `program`, `available_periods`; PublishedDeal `published_period`,
  `available_periods`, `upload_id`, `published_at`, `published_by` (period picker and the admin strip; without them
  the picker hides and the strip shows "No upload on record").
- RESOLVED in integration/wave3 (Matt: both partners see both programs; program_partner) — 2026-11-03 — to Lead (seed/programs.json): the brief says manager owns MOVE Trust, but `seed/programs.json` gives both
  programs to `investor`, so on a seeded stack `manager_viewer` sees an empty portfolio and 404 on both programs.
  The UI handles either; the demo script needs one of them to be true. My tests use the brief's ownership.
- RESOLVED in integration/wave3 (Button as="link"; KpiTile no longer ellipsizes; LinkButton and .pf-kpis removed) — 2026-11-03 — to Design System (optional): `.ds-kpi__value` is `nowrap` + ellipsis, so a nine-digit balance in a
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
- 2026-11-03 — to UI-Review (wave 3): `src/review/__tests__/ReportsLibraryPage.test.tsx` › "links to the deepest registered
  portfolio route" fails on integration/wave3 as merged (before any UI-Partner change): it still expects `/admin/portfolio`, but the
  nested admin routes now exist, so `partnerViewPath` returns `/admin/portfolio/f-pil-2-0/deals/x?period=2026-08`. Update the expectation.
- 2026-11-03 — to Lead (wave 3): the deal page shows `deal.data_corrections` as published (period, readable field label from
  `record` + the last non-index segment of `field`, was / now, reason, rule_id + choice when present, applied). Values are typed
  by field name (…_pct / utilization → %, …contracts → count, …_ratio → x, else $). Non-numeric values print as text.

## QA & Demo
- RESOLVED in integration/wave3 (README section applied) — 2026-11-03 — to Lead (README, please apply): add an "End-to-end demo tests" section to the root `README.md`:
  > Prerequisites: Docker Desktop, Node 20+, Python 3.11+ with `pip install httpx pypdf`, the 12 SetRep PDFs in
  > `data/samples/`. From the repo root: `cp .env.example .env` (fill in `ANTHROPIC_API_KEY`), `docker compose up -d
  > --build`, `docker compose exec api python -m app.seed` (Git Bash: prefix `MSYS_NO_PATHCONV=1` if a path argument
  > is mangled). Then `cd tests/e2e && npm ci && npx playwright install chromium && npm run test:e2e`. The demo needs a
  > fresh database; reset with `docker compose down -v` and repeat the up and seed. `npm run lighthouse` scores the four
  > main pages after a run. Point the tests at another stack with `E2E_WEB_URL` / `E2E_API_URL`. Walkthrough and
  > acceptance results: `docs/demo.md`.
- RESOLVED in integration/wave3 (Matt: corrected re-issues with replace=true; step 7 rewritten as re-issue → accept as replacement → publish → regenerate in `specs/07-reissue-regenerate.spec.ts`) — 2026-11-03 — to Lead (demo script, step 7): "Regenerate dashboard after re-uploading month one" cannot be run.
  `POST /uploads` returns 409 `already_published` for a published deal + period (`api/app/main.py: create_upload`),
  so the R12 replace branch in `approve` (`pub is not None`) is unreachable, and a published upload cannot be rejected
  (`bad_state`). Either allow a replacement upload of a published period (R12) or change step 7 to regenerate only.
  Test: `specs/07-regenerate.spec.ts` asserts today's refusal, then regenerates; flip it when the decision is made.
- RESOLVED (Matt: toast dropped; clause removed from the spec and docs/demo.md) — 2026-11-03 — to Lead / UI owners (demo script, step 6): "the covenant status change raises an in-app toast" has no
  implementation (no covenant-change toast in `web/src`) and no data: all three F-PIL reference objects have
  `prior_covenants` equal to `covenants` for Jul → Aug, and `deals_with_escalations` is empty after step 6. Test:
  `specs/06-next-month.spec.ts` records it as an annotation. Needs a decision whether to build it (wave 3 per the risk
  table) or drop the clause.
- RESOLVED in integration/wave3 (contrast fixes; dashboard, portfolio and deal page now 100) — 2026-11-03 — to Design System (Lighthouse, all four main pages, scores 93–96 so the gate passes): colour contrast
  fails on the sidebar group labels (`.navlabel` #8c86b3 on #2a255f, 4.04:1 at 7.9 pt), muted text `--text-3`-style
  #8b8597 on #fffaf3 / #ffffff (3.42–3.55:1: breadcrumbs, `.ds-pagehead__sub`, `.ds-kpi__label`, `.ds-kpi__context`,
  `.ds-card__sub`), and the OK / WATCH pills (#1f9d6b on #e7f5ee 3.06:1, #bd7a18 on #fbf0da 3.11:1). Run:
  `cd tests/e2e && npm run lighthouse` (reports in `tests/e2e/.cache/lighthouse/`). Likely covered by parallel change (3).
- RESOLVED in integration/wave3 (no longer reported by Lighthouse) — 2026-11-03 — to UI-Review (Lighthouse, Review report 93): `label-content-name-mismatch` on every page link
  (`button.rv-srclink`, visible text "p. 2", accessible name "Tranche balance, Opening: open source page 2"; start the
  name with the visible text, e.g. "p. 2: Tranche balance, Opening") and `target-size` (the "p. N" buttons are under
  24 px). Same run as above.
- RESOLVED in integration/wave3 (Approval queue nav entry) — 2026-11-03 — to Design System / UI-Review (navigation): the Approval queue (`/admin/uploads/queue`) has no sidebar
  entry and no link from Uploads or the Dashboard; the demo reaches it by URL or through "Open in approval queue" after
  an upload. Suggest a Queue tile link on Uploads or a nav entry. Tests use the URL (`specs/01`, `specs/02`).
- RESOLVED (Lead: no invented programs; `specs/08-negatives.spec.ts` adds unknown and missing X-Partner on the published routes beside the spoof and the redirect) — 2026-11-03 — to Lead (tenancy after wave 3): once both programs are shared with investor and manager, no program is
  hidden from either partner, so "a partner cannot reach another partner's data" has nothing left to try beyond the
  `X-Partner` spoof and the shell redirect (`specs/08-negatives.spec.ts` then records "hidden none"). Suggest a seeded
  partner-only program (or a third partner) so the negative test stays meaningful.
- 2026-11-03 — to Lead (brief): `tests/e2e/CLAUDE.md` lists `scripts/reset_demo.py` as a QA deliverable, but my
  assignment is `tests/e2e/` and `docs/demo.md` only, so I did not create it. Reset is `docker compose down -v`, up,
  seed; the seeded-error PDF comes from `scripts/demo_data.py: seeded_moneda_aug` (the e2e setup calls it). If you want
  a single reset script in `scripts/`, say so and I will write it, or take the commands from `docs/demo.md` › Reset.
- RESOLVED (setup trimmed to 7 history uploads; full demo 5 min 16 s and 4 min 43 s from `down -v`) — 2026-11-03 — to Lead (acceptance): "full demo under 10 minutes including seed" measured 11 min 17 s from
  `down -v` (build + start + seed 3 min 18 s, tests 8 min of which 3 min 24 s is publishing May–July for three deals
  through the API). The extraction runs one upload at a time; the setup could skip Stride May–Jul (−45 s) if step 6
  used a deal already in the history, or the worker could take jobs for different deals in parallel.
- RESOLVED by api 35a3155 (process-wide PDFium lock, atomic PNG writes; two clean runs green) — 2026-11-03 — to Data & API (BUG, blocks a green demo intermittently): concurrent requests for not-yet-rendered page
  images kill the API server process. `GET /uploads/{id}/pages/{n}.png` renders with pypdfium2 inside FastAPI's thread
  pool (`api/app/main.py: page_image`); PDFium is not thread-safe, the uvicorn server process dies without a log line,
  and with `--reload` the reloader stays up but nothing serves :8000 (every request times out until `docker restart`).
  Failing test: `specs/04-seeded-error.spec.ts` (step 4, the R05 page crop), failed in 1 of 2 full clean runs (passed in 2 earlier single runs); every later
  test then times out. Reproduce on a fresh upload: fire 12 parallel `curl -H "X-Role: tao_admin"
  .../uploads/<id>/pages/{3..8}.png` (two per page): 10 answer 200, the rest never answer and `/health` times out.
  Suggested fix: a process-wide lock around the PDFium open/render/save (or render all pages once in the worker after
  extraction), and write the PNG to a temp name then rename so two requests for the same page do not race.
- 2026-11-03 — to Design System (Lighthouse, Review report 96, gate passes): colour contrast on a resolved finding card
  (`.ds-finding--resolved`): `.ds-finding__layer` and `.ds-finding__vlabel` #8e8997 on #ffffff 3.4:1, the small Block
  pill #cc605c on #fbeae8 3.34:1, and our value `.ds-finding__v--ours` #8b63e1 on #ffffff 4.22:1. Looks like the
  resolved-state dimming pushes them below 4.5:1. Page: Review report of the published seeded Moneda 2026-08
  (`npm run lighthouse`, report in `tests/e2e/.cache/lighthouse/review-report.html`).
- 2026-11-03 — to Rules / UI-Review (minor): the R12 re-issue message prints the raw timestamp ("published
  2026-11-04T02:00:46.429157+00:00") and the card shows the period as REPORT "2026-05" with OURS and DIFFERENCE "—";
  the banner above it formats the same time as "2026-11-03 21:00". Suggest a date-only or formatted time in the message
  and no ours / report row for R12.
- 2026-11-03 — to Lead (docs/demo, cleanup): five screenshots are no longer produced or referenced by docs/demo.md:
  `03-other-partner-no-access.png`, `07-audit-regenerate.png`, `07-regenerate-dialog.png`, `07-reupload-refused.png`,
  `08-manager-no-access.png` (they show pre-wave-3 behaviour). I did not delete them (no-delete rule); remove them at
  merge if you agree.
- 2026-11-05 — Rules to Data & API (context parity, R14): worker/validate's master now carries
  `covenants_recorded` = number of current covenant_definition rows for the deal (superseded_at null, any
  effective_from). R14 uses it to tell "deal has no definitions" (one collapsed note) from "none in force for this
  period" (one note per covenant, e.g. Stride before 2026-01-22), because `covenants` holds only rows in force.
  Please add the same key in api/app/review.py build_context; without it the override re-run falls back to
  len(covenants), so a Stride December 2025 re-run would show the collapsed note instead of the four per-covenant notes.
- 2026-11-05 — to UI-Admin / Design System (bug, wave B): on the Program / facility record
  (`/admin/partners/investor/programs/f-pil-2-0`) the Covenant definitions table is about 1,478 px wide inside a card
  1,131 px wide at the suite's 1440 x 900 viewport. The card is `overflow-x: clip` and `.ds-table-wrap` does not scroll, so
  the last columns, Actions (Edit) and History, are cut off and cannot be reached, for TAO Admin and analyst, filtered to
  one deal or not. The wide columns come from the banded threshold text (Moneda 9.1 (c)) and Stride 9.1 (g)'s long
  description. Failing test: `specs/10-editing.spec.ts` "known bug: covenant Edit and History are reachable at 1440 x 900"
  (marked `test.fail`, so it passes while the bug is there); step 10c runs at 1920 x 1080 until it is fixed. Suggest
  `overflow-x: auto` on the table wrap, or wrapping the threshold and description cells.
- 2026-11-05 — to Rules / UI-Review (minor, wave B): editing `/tranche_balance/principal` (or recoveries, interest) on a
  MOVE Trust report re-runs the rules with no finding, because R05 reads the current `/period_history/<i>` row and only
  compares page 2 opening and closing with it. The edited page-2 principal then publishes beside an unedited
  roll-forward principal. The Edit dialog says "No finding on this report names this value, so no rule is known to read
  it", which is accurate. Consider R05 also comparing principal, prepayments and losses on page 2 with the row, or the
  edit dialog offering to change both copies. Seen on Essex 2026-04 through the API.
- 2026-11-05 — UI-Review to Lead / Data & API (wave C, contract gap): D7 note 7 says both TAO roles can @mention, but
  `GET /users` is TAO Admin only (C3), so a TAO Analyst gets 403 `company_admin_only` and has no mention list. The review
  page falls back to the people already on the upload's threads, which misses anyone who has not commented yet.
  Suggest letting tao_analyst read `GET /users?partner_slug=tao&status=active` (id, name, email, role only), or a small
  `GET /users/mentionable` route. Nothing else in the review page depends on it.
- 2026-11-06 — to UI-Review / Data & API (bug, wave C): a TAO Analyst cannot @mention anyone from the comment box.
  Typing @ lists nobody. `GET /users?partner_slug=tao&status=active` answers an analyst with `{id, name, email, role}`
  (`api/app/main.py` list_users, the "@mention list" branch), without `status`, and the composer's `mentionMatches`
  (`web/src/review/lib/comments.ts`) keeps only `u.status === 'active'`, so every user is dropped. A TAO Admin gets the
  full user rows and can mention. Fix either side: add `status` to the analyst branch, or drop the status filter
  there (the API already filters status=active). Failing test: `specs/11-people.spec.ts` "known bug: an analyst can
  pick a TAO user from the @ list" (marked `test.fail`); step 11c starts the analyst's thread with the mention through
  the API until it is fixed.
  Fixed 2026-11-06 by the Lead on integration/wave-c: the analyst rows now carry `status`. The publish dialog's
  reason order also changed: for partner users the system switch (`partner_notifications_off`) now outranks
  `not_subscribed`, so the "Partner notifications are off" line shows even when no partner is subscribed.
- 2026-11-06 — to Lead (note, wave C, not a bug): `GET /uploads/{id}/recipients` gives an unsubscribed partner user
  `not_subscribed` even while partner notifications are off, so with nobody subscribed the Publish dialog's "Partner
  notifications are off" line does not show. Step 11d subscribes D. Alvarez first, then checks the "off" reason.
  If the dialog should always say notifications are off when they are, the banner could read the setting rather than
  the reasons.
- 2026-11-06 — Data & API to Lead (wave D, contract gaps and choices; built as below, change the contract if you want
  otherwise):
  1. A deal on no company (CompanyPatch: "shows as its own row named after the deal") has no slug in the contract. The
     API gives that row the deal's slug, and `GET /companies/{deal_slug}`, `/deals/{deal_slug}/insights`, `/news` and
     `/adverse` read it (no record fields, no contacts, `news` and `adverse` empty, `not_screened`). Writes (PATCH,
     notes, contacts, follow) on it are 404: create a company for it first. A company slug equal to a deal slug would
     hide that deal's row; worth a check in the contract (or a `kind` on CompanyRow).
  2. `Company.owner` is required, but "Partners get the same object without owner": partners get `owner: null`.
  3. Covenant history: MOVE Trust has no covenant definitions in master data (seed has F-PIL 2.0 only), so no definition
     is in force for a MOVE month before its publication and those cells are `{status: null, source: null}`. Recompute
     works for F-PIL 2.0 (Stride from 2026-01, when its definitions start). Needs MOVE Trust definitions in
     `seed/covenant_definitions.json` or entered in Master data.
  4. Months: series and covenant-history months are ratio_history months. F-PIL 2.0's 2026-08 report carries ratio month
     2026-07, so its published cell is 2026-07 (a publication's ratio month = the last month of its ratio_history).
  5. Not specified, chosen: WatchSignal severities (covenant_near_limit, obligor_near_limit, losses_high, report_late:
     watch; rising_3m: rising; utilization_high, restated: info); anchors beyond the examples (`losses`,
     `pool-balance`, `next-report`); rising_3m = the last three month-to-month moves all the bad way (up for a ceiling
     metric, down for a floor; by the covenant's kind when there is one, else ICR and total equity are floors); LossPeer
     "range" = the largest absolute value in the 13-month window; balance_median_change = median of
     (closing_balance - opening_balance) / opening_balance over the other deals, null under 2;
     restatements field for a TAO correction is `<record>.<field>` (e.g. `period_history.interest`), changed_in the
     `applied` date; next_report counts any upload of that period (any status) as received, and business_days_late is
     the Mon-Fri days after due_on while nothing is uploaded (so it can be 1-4 with late false).
  6. The seed links a deal only when it has none, as asked, so a deal a TAO Admin deliberately left on no company is
     linked back by the next seed run. If that matters, the seed needs a marker for "unlinked on purpose".
  7. Partners see a reviewed adverse item's `note` (AdverseItem.note, the TAO review note). Say if that note should be
     TAO only.


## News
- 2026-11-06 — To Data & API (no contract change needed): Run now = insert `news_run` (trigger `manual`, status `queued`), then `LPUSH news <run id as a plain string>` (list name from `NEWS_QUEUE`, default `news`). The worker BRPOPs and treats the message as a wake-up only: it runs every queued row oldest first, so the payload shape is not load-bearing and a lost push still runs within a minute. `run_active` should look at both `queued` and `running`; the worker fails any row left `running` when it restarts, and fails a queued row with `{company_slug: null, source: "worker", message: "company_feeds is off; nothing was fetched"}` if the setting was switched off before it started. The worker reads companies from the `company` table only: seeding `seed/companies.json` into it is on the API side.
- 2026-11-06 — To Lead / QA: for a deterministic e2e the news container needs `NEWS_SOURCE=fixture` and `NEWS_FIXTURE=/app/fixtures/example.json`. Today that means adding both lines to `.env` (the service reads `env_file: .env`). Suggest an e2e compose override that sets them on the `news` service so a fresh `docker compose up` needs no hand edit. One run of the example fixture against the 10 seed companies writes 10 news items and 7 open adverse items (format and expected rows in `news/README.md`).

- 2026-11-06 — UI-Admin to Lead / Data & API (wave D, contract gap): the AuditEntry description lists detail shapes for
  wave C but not for the five wave D actions. The Audit log renders them from the shapes below and reads every field
  defensively; please write these (or tell me the real ones) and add them to the AuditEntry description:
  `company_change` {company_slug, company_name, change: created|updated|contact_added|contact_updated|contact_removed,
  contact_id (contact changes), before, after} where before/after hold only the changed record fields (deal_slugs as the
  full list, owner_user_id) or the contact object; `company_note` {company_slug, note_id, body, mentions,
  collection_period}; `company_note_edit` {company_slug, note_id, change: edited|removed, before: old text, after: new
  text or null}; `adverse_change` {company_slug, adverse_id, category, title, state: reviewed|dismissed, note};
  `news_run` {run_id, trigger: manual}. Subject links go to `/admin/companies/<slug>` (and `?note=<id>` for notes).
