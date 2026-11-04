# Progress log

Append an entry when a work package lands. Newest first.

- 2026-11-04 — QA & Demo, MOVE Trust in the demo (merged main b40a3f3): `specs/09-move-trust.spec.ts`, three tests in
  order. 9a: Essex, TLFC LP and Finloc April uploaded by the analyst and published by the admin (API); Essex May through
  the upload form gets two R11 restatement Blocks (April ICR 1.15 → 1.12, D/E 6.35 → 6.22), the admin accepts each as a
  restatement with a reason and publishes; the MOVE program (May) then shows TLFC LP and Finloc "As of Apr 2026"
  (`deals_behind` too). 9b: TLFC LP May, Finloc May, then TLFC LP June with two R11 restatements (Apr and May RVL ratio
  0 → 0.112487%) accepted in the UI and published. 9c: Finloc June and July; Finloc May–July raise no R11 (CAD-equivalent
  gap = revaluation +64,124.04 / +106,968.53 / −47,609.31, CAD opening = prior CAD closing); Finloc July investor deal
  page vs `move-trust-finloc-2000-inc.dashboard.json`: 209 numbers, 0 mismatches. Published ratio_history and
  `restatements` checked against the references. Facts in `lib/facts.ts` (DEALS essex / tlfcLp / finloc, MOVE,
  STEP9). `lib/deal.ts`: rows sharing an id (Finloc's two "MSA (Definitions)" covenants) now match by occurrence.
  docs/demo.md: step 9 walkthrough with 8 new screenshots; steps 2, 3, 6 and the blank-PDF negative follow main
  (both portals in the publish dialog, "As of Jul 2026" on F-PIL, deals_behind, failure_reason on the card); every
  screenshot retaken. Two clean runs from `down -v`: 21/21 and 21/21, 8 min 38 s and 7 min 25 s including start and
  seed; step 9 about 3 min. Nine uploads instead of seven because Finloc must reach July for May–July and for the
  reference comparison (MOVE extraction 11–23 s each). Run: as docs/demo.md, with data/samples/move-trust/ in place.
  The five orphaned screenshots listed in requests.md (2026-11-03) are still in docs/demo/ for the Lead to remove.
- 2026-11-04 — UI-Partner, latest month (merged main 9ce35c8 and lead/latest-month cb12a95): built against
  `PublishedProgram.deals_behind`. A deal behind the program month shows a blue "As of Jul 2026" pill (dot plus word)
  on its Program Executive Summary card, its Program Dashboard deal row and covenant rows, its Portfolio flagged-deal
  row, its Go to deal option, and in the deal page header. Program totals (both program pages and each portfolio card)
  carry one line: "Moneda Capital Corp. is as of Jul 2026; its Aug 2026 report is not published yet." Several deals
  are listed as "A (Jul 2026), B (Jun 2026) and N more are behind; …". Every deal link (cards, deal rows, flagged rows,
  Go to deal, prev / next) now carries `?period=` = the deal's own month (`as_of` when behind, else the program
  month). The deal page reads the program at its latest month when the deal is at its newest publication (so prev /
  next open each neighbour at its own newest month), and at the deal's month otherwise. The deal month picker already
  used the deal's own `available_periods`. Empty or absent `deals_behind`: no pill, no note, links at the program
  month. Tests: portfolio 70 (new `behind.test.tsx`, 7: F-PIL references with one change, Moneda published for
  2026-07 only, fake API 404s it for 2026-08). Full web suite 348 pass, 1 fail in `src/admin/__tests__/DashboardPage.test.tsx`
  (MOVE covenant totals row, fails on main without this change too; UI-Admin's). tsc and check_contracts green.
- 2026-11-04 — Design System: merged lead/latest-month and agent/api (302cd45, Upload.failure_reason). The upload card
  and the failed upload's review footer show `failure_reason` to tao_admin and tao_analyst, with the usual-cause text
  when it is null; neither reads the audit log any more. Help "When extraction fails" updated. Web 376 passed, 17
  skipped; tsc clean; check_contracts green.
- 2026-11-04 — Design System, help-page gaps fixed (Lead-authorized, in web/src/admin and web/src/review for this task):
  (1) the upload card's R04 hint reads the reporting lag per template from `reporting_lag_months` in rules.yaml
  (F-PIL 1, MOVE Trust 0), so MOVE uploads no longer warn; (2) Extraction failed states the worker's reason to TAO
  Admin (extract audit row) and the usual cause plus next step to analysts, on the upload card and the review footer;
  (3) the publish dialog names every partner in `partner_slugs` ("the Investor and Manager portals"); (4) the reject
  dialog says the status turns to Rejected and the reason goes in the audit log; (5) failed uploads get a Details link
  in Uploads / Upload history / Dashboard and "Upload details →" on the card; (6) Audit log in the Account nav
  (tao_admin); (8) Dashboard test expects MOVE OK 84. Help text updated to match, workarounds removed. Spot-checked on
  the tao-help stack: a MOVE Dynamic Capital 2026-04 upload through the form shows no R04 warning; a blank PDF shows
  the reason to TAO Admin and the generic cause to an analyst, both reached from Upload history › Details; publish and
  reject dialog wording; Audit log in the sidebar. Tests: web 375 passed, 17 skipped, 0 failed; tsc clean;
  check_contracts green. Gap 7 (latest month per program) waits on the operator.
- 2026-11-04 — Design System: Help & support built for both shells (`/admin/help`, `/investor/help`, `/manager/help`),
  registered in pages.ts with `built: true`. Content is data in `web/src/shell/help/content.ts`; `HelpPage.tsx` renders
  task sections with numbered steps, a glossary ("What the words mean"), a search box (every word must match; kept in
  `?q=`), an "On this page" list and an anchor link per section (`#publish` scrolls under the top bar and takes focus).
  Each block can carry `roles`: tao_analyst sees no resolve / re-extract / publish / reject / audit sections and gets
  "what you cannot do" lines; partner Company Admins get the Team members placeholder note. Page links resolve per
  shell (partner paths gain /investor or /manager). Every step was walked on a private stack (tao-help, review
  profile): role switcher, dashboard, upload form and the re-issue note, Moneda Aug R05 Use ours → publish (dialog
  text, data corrections on the investor deal page), re-extract dialog, Reports library regenerate ("rebuilt from 8
  published reports"), audit log filters, a blank PDF → Extraction failed with the reason in the Extract row, a MOVE
  Trust upload (Dynamic Capital 2026-04, reporting period 2026-04, no findings), program record, analyst read-only
  footer. Known findings listed for testers come from that run and the Rules entries (Xpedite Jun/Jul R11, Moneda May
  R18 ×2 + R19, Essex May and TLFC LP Jun R11, R19 notes). Tests: `cd web && npx vitest run src/shell` (41; help 22:
  rendering through the shell, role filtering, search, every link resolves to a built page open to the role, banned
  words, no invented contact details). Full web suite 369 passed, 1 failed (DashboardPage MOVE OK 83 vs 84, from main
  01cf274, not this change). Gaps and confusing flows: docs/requests.md › Design System, 2026-11-04.
- 2026-11-04 — Extraction: MOVE reference corrections (Lead-authorized, nine move-trust-*.dashboard.json files only;
  every value checked against the printed PDF value, formatting byte-stable: json indent=1, only changed lines move).
  TLFC LP rvl_ratio_pct is a real restatement, not a misread: May report p.14 prints RVL Ratio Apr-26 0.000000% and
  May-26 0.000000%; June report p.14 prints 0.112487% for both (Residual Losses '-' in both). No extraction change.
  Changed values (deal, path: old -> new, PDF page, report):
  * Dynamic (p.2 Pool Balances row): ph[1] (May) losses -1,363,634.47 -> 0.0; interest 126,978.64 -> 1,438,341.43
    (interest collections 1,363,634.47 + prepayment excess 74,706.96); recoveries -216,554.61 -> 52,271.68.
    ph[2] (June) principal_prepayments 7,286,831.27 -> 3,260,076.37; losses -1,465,986.69 -> 0.0; interest
    281,325.43 -> 1,747,312.12 (1,465,986.69 + 281,325.43); recoveries -33,189.86 -> 0.0; new ineligible_buyback
    4,026,754.90 (Buyback column d).
  * Finloc (p.18, July): top10_obligors[0..9] obligor_concentration_pct / concentration_limit_pct /
    concentration_limit_per_obligor / excess_concentration_amount moved back into their own columns, e.g. [0]
    6,769,167.28 -> 13.99%, 13.99% -> 5.00%, 5.00% -> 2,419,344.46, 2,419,344.46 -> 4,349,822.82; excess for
    [1..9]: 1,680,800.32 / 1,048,295.86 / 698,057.36 / 557,899.91 / 327,073.93 / 0 / 0 / 0 / 0 (printed '-').
  * TLFC LP (p.2 yield formula (e+f)): ph[0..2] interest 970,074.70 -> 968,695.49; 926,282.50 -> 925,480.05;
    946,299.86 -> 942,243.56. TLFC Loans (p.2, (e+f)): 105,960.85 -> 98,599.13; 93,794.33 -> 90,738.77;
    144,871.57 -> 141,119.85.
  * TLFC Leases: inserted the printed lock-up test "Is the amount on deposit in the Deferred Account less that 75%
    of the Required Deferred Amount ...? No" (p.8/p.17) at covenants[3] and prior_covenants[3];
    covenant_summary.OK 13 -> 14.
  * charge_off null -> printed amount (p.2 adjustment column, downward part): Dynamic, Essex, VCC IV ph[0..3] 0.0;
    Finloc ph 0.0 / 6,011.10 / 0.0 / 4,163.85 and tranche_balance 4,163.85; TLFC LP ph and tranche_balance 0.0;
    TLFC Leases ph 0 / 0 / 0 / 0.01, tranche_balance 0.01; TLFC Loans ph 0.01 / 0.03 / 0 / 0, tranche_balance 0.0;
    TPine ph 0 / 0 / 0 / 0.04, tranche_balance 0.04. Meridian already carried it.
  * adjustment_increase added where printed (upward part): Essex ph[1] 0.01; Finloc ph[0..2] 35,289.34 /
    50,888.50 / 8,425.37 (CAD equivalent); TLFC LP ph[0..3] 3,035.22 / 2,551.21 / 2,972.92 / 2,782.68 and
    tranche_balance 2,782.68; TLFC Leases ph[0] 0.01, ph[2] 0.01.
  * Covenant text quoting June next to July values, replaced with the July report's: Essex MSA 8.1 (j)
    description "exceeded 25%" -> "15%", threshold 0.25 -> 0.15 (p.14); MSA 8.1 (l) description (adds "following
    the OC Rebalancing Date (where applicable)" / "of such Securitization", p.8); clean-up note tranches "10, 11,
    12, ..., 17, 19, ..." -> "10 - 11, 13 - 23, and 25" (p.14 footnote). TPine MLA 7.1 (v) note differential
    -9,965,355.40 -> -9,875,676.11 (p.10). VCC LSA SRE (t) description adds "(where applicable)", note
    -135,257.83 -> -0.01 (p.8). TLFC LP 7.1 (t) description (July wording, p.11), 7.5 description "24 of 97" ->
    "24 of 98" (p.17). TLFC Leases 7.1 (u) description (July wording) and note -0.06 -> -0.01 (p.11); 7.5
    description "19 of 74" -> "17 of 74" and footnote tranche list (p.17). TLFC Loans 7.1 (s) note -0.06 -> -0.05
    (p.11).
  * source_pages plainly wrong: Meridian quantitative_tests null -> 11, financial_ratios 1 -> 11; VCC IV
    enhancement 5 -> 7; TLFC Loans cumulative_losses 13 -> 15.
  Left as they were: data_corrections, oldest ratio_history months, other source_pages (convention differences),
  and the remaining listed quirks in tests/test_move_*.py (not on the Lead's list). Quirk lists shrank to match;
  all 80 MOVE sample tests pass, and with Rules' R03/R04/R05 on main no MOVE report raises a phase-1 block.
- 2026-11-04 — Rules, wave 2 (MOVE Trust): merged lead/move-trust. `engine.run` hands top-level rules.yaml settings
  (`reporting_lag_months`) to every rule as `rule["settings"]`. R04 expects collection_period = reporting_period + the
  template's lag (F-PIL 1, MOVE Trust 0, unknown 1) and names it in the message. R05 adds + adjustment_increase +
  balance_adjustment. R03 gives loss and CNL ratios −5..1 (TPine −113.21% / −130.68% pass, 113.21 still blocks). New
  fixtures cover r05-adjustment-increase, r05-charge-off-move and r05-balance-adjustment. Reference gaps for Finloc and
  TLFC LP stay documented as reference-data gaps. Over the 36 MOVE extractions from agent/extraction, phases 1+2,
  with the previous month as prior: R03/R04/R05 0 (was 2/36/7). What remains is R11 ×7 (Finloc FX re-translation,
  Essex and TLFC LP restatements; see requests.md › Rules) and R19 notes ×8. Tests: rules 104, worker/validate 19,
  check_contracts green.
- 2026-11-04 — Extraction: wave 2, MOVE Trust. `move-trust-settrep-v1` is a dispatch template choosing one of four
  layouts from page-1 keywords: servicer-report (Meridian), multicurrency (Finloc), guarantor (TLFC LP, Leases,
  Loans) and standard (Dynamic, Essex, TPine, VCC IV), each a template plus an engine under
  `worker/extract/engines/` (hook in `extract()`; `meta.layout` names the layout). For all nine deals, chain()
  and month-by-month extend() over April–July reproduce the reference objects except listed quirks (per-deal
  dicts with reasons in `tests/test_move_*.py`). Interest is the effective-yield income each report's formula
  prints, so fresh extractions equal the post-correction references. Roll-forward: `charge_off` /
  `adjustment_increase` close R05 in all 36 reports (Finloc, TLFC LP and Meridian gaps explained); R05 needs the
  `adjustment_increase` term, R04 a per-program offset (MOVE reporting month = collection month). history.extend
  now reads the reporting-month lag from the extraction. Slow tests: `@pytest.mark.slow`, skipped unless
  `EXTRACT_ALL=1` (`EXTRACT_SAMPLES_DIR` points at a checkout with data/samples). Run everything:
  `EXTRACT_ALL=1 python -m pytest -q worker/extract/tests` (about 20 min).
- 2026-11-03 — Lead: wave-3 decisions (branch lead/wave3). Matt chose: (1) a program can be visible to several
  partners; migration 004 adds `program_partner`, Program/Upload gain `partner_slugs`, and both partners see MOVE
  Trust and F-PIL. (2) use_ours / use_report change the published value: findings gain optional `targets` (JSON
  pointers to every copy of the value); approve writes the chosen value there and appends `data_corrections`; no
  targets means 409 `no_target`. (3) the API's extra fields and error codes are now in openapi.yaml, plus
  `GET /master/partners`, `CovenantDefinition.unit`, and `collection_period` / `action` query filters.
- 2026-11-03 — Lead: UI-wave prep (branch lead/ui-prep). `web/vite.config.ts` reads VITE_PORT and VITE_API_PROXY, so a
  dev server can sit beside compose's :5173 and proxy /api to any API (set VITE_API_URL=/api/v1; no CORS change).
  `scripts/compose.agent.yml` gives each agent a private stack (API on ${API_PORT}, no host ports for Postgres/Redis).
  `scripts/demo_data.py --profile admin|review` loads demo state through the HTTP API from the real samples; review
  leaves a seeded Moneda Aug (R05 −100.00) in needs_review. Approving accepts R11 restatements first: Xpedite's Jun
  and Jul reports revise Jan-26 equity/D-E and May-26 rolling loss ratios, exactly as the reference `restatements` list.
- 2026-11-03 — Extraction: wave 1c history. `worker/extract/history.py: extend(prior_deal, extraction)` chains one
  upload onto the deal's last published object (an earlier extend/chain result or a seeded reference object):
  period_history oldest first, aging_history newest first, ratio_history gaps, restatements, balance
  discontinuities, prior_covenants (with the prior CNL value) and prior closings. Pure; extend(None, ex) is ex;
  a prior that is not before the extraction's period raises ValueError. May→Jun→Jul→Aug month by month equals
  chain() and the reference object for all 3 F-PIL deals. Carried months get no `sources` entries (the schema
  requires a page); meta.history says "published <period>" and lists the carried pointers. worker/main.py passes
  `extend=history.extend` to handle_extraction when its signature accepts it (inspect), else the plain call. A PDF
  with no text on page 1 now fails with "page 1 has no text layer; cover block not found" (ExtractionError)
  instead of an IndexError. Tests: 62 in worker/extract/tests.
- 2026-11-03 — Data & API: seed paths require content. `app/seed.py` picks the first seed folder that holds
  partners.json and the first reference folder with a *.dashboard.json, so an empty compose mount point (api/seed) no
  longer shadows the real one. Decoy tests in tests/test_seed.py; 113 API tests pass.
- 2026-11-03 — Data & API: wave 1b schema parity. Merged lead/wave1-seams. `api/app/models.py` now matches migration 001
  for raw-SQL writers (worker/validate): the five timestamp columns have `server_default=now()` as well as the Python
  default, and ids are stored on SQLite as the dashed 36-character text PostgreSQL prints (was 32-char hex, so raw
  updates by the API's id matched 0 rows). New `tests/test_schema_parity.py` inserts an extraction with raw SQL (dashed
  upload id, no created_at) and reads it back through the API; it fails on the old models. 111 passed on SQLite and on
  PostgreSQL 16 built from db/migrations. Existing SQLite files built by the old models must be deleted and re-seeded.
- 2026-11-03 — Data & API: wave 1 deliverables 1–7. All 23 operations in `contracts/openapi.yaml` are real and backed by
  the database (SQLAlchemy models over 001 + new migrations 002/003). Seed: `python -m app.seed` loads seed/*.json
  idempotently; `--reference-publications` also publishes the 12 real deal objects for the partner portals. Uploads store
  the PDF under `FILE_STORE/uploads/<id>/source.pdf`, count pages with pypdfium2, push `{"upload_id","pass":1}` to
  `extract:jobs`, refuse a published period (R12, 409). Override resolves the finding, writes `override`/`restate` to the
  audit, re-runs `rules.run()` and merges findings (ids and resolutions survive). Approve refuses while a block finding is
  open, writes the publication and approve/publish/regenerate audit entries. Page images render at 110 dpi and are cached.
  Program roll-up (`api/app/rollup.py`) reproduces both real program files total for total and is computed on read.
  Partner scoping is `partner_filter` + `visible_programs` in `api/app/main.py`; another partner's program or deal is a 404.
  Run: from `api/`, `python -m pytest -q` (110 tests, SQLite); `TEST_DATABASE_URL=postgresql+pg8000://...` runs the same
  suite on PostgreSQL built from `db/migrations` (110 passed against postgres:16-alpine). Stubbed: regenerate only bumps
  `rollup_version` and audits (roll-ups are never stale); `actor_label` is the role until real sign-in. Needs: compose mount
  for the demo seed, contract fold-in of extra fields/errors, worker status/row conventions (all in `docs/requests.md`).
- 2026-11-03 — Lead: wave-1 seam decisions (branch lead/wave1-seams). Roll-forward terms: `charge_off` is the one
  name for the page-2 NPV adjustment (column i), already in the reference data; `new_funded` (+) and
  `ineligible_buyback` (−) are new optional period_history fields, all positive amounts. R05 is now opening +
  new_funded − principal − prepayments − losses − charge_off − ineligible_buyback. `covenants[].reported_triggered`
  (YES/NO) is in the schema and R18 uses it. rules.yaml also takes Rules' R03 range, R09 fn and R18 floor band.
  Compose: worker runs `python main.py` from /app (imports `extract`, `validate`, `rules`); api mounts
  docs/dashboard-json for the demo seed. Worker hand-off: worker/validate owns every database write
  (`mark_extracting`, `handle_extraction`, `mark_failed`); worker/main.py calls them.
- 2026-11-03 — Design System: wave 1 delivered on `agent/design`.
  Built: `web/src/design/components` (import everything from `@/design/components`): Button (primary / ghost /
  danger, sm, icon, loading), StatusPill plus UploadStatusPill / SeverityPill / FindingStatusPill / CovenantPill with
  the contract vocabularies mapped once (UPLOAD_STATUS, UPLOAD_TERMINAL for the 2 s polling stop, SEVERITY,
  FINDING_STATUS, COVENANT_STATUS incl. AVAILABLE), Card, KpiTile + KpiRow, DataTable (sticky header under the top bar,
  numeric columns right-aligned tabular, sort, row expand with controlled Expand all, clickable rows, footer totals,
  empty state, skeleton rows, compact density, fixed-height scroll), FindingCard (renders a finding.schema.json object
  as is: rule id, severity, status, message, ours / report / difference / tolerance by unit, context arithmetic,
  source page, resolution; crop slot and action slot), Field + Input / Select (grouped options) / Textarea, FileDrop
  (accept + size validation, keyboard), ToastProvider + useToast (bottom-right, 6 s, pause on hover, max 3), Dialog
  (focus trap, Escape, focus return, alertdialog, non-dismissable while busy), Breadcrumb, SkeletonBlock, PageHeader,
  StatePanel (empty / error / no-access / not-found), format helpers (formatCurrency, formatPercent, formatNumber,
  formatSigned, formatPeriod, formatByUnit, formatDiffByUnit), inline SVG `icons`.
  Shell (`web/src/shell`): user-card role switcher in the sidebar footer (menu, arrows / Enter / Escape), Workspace /
  Account nav with icons, top bar = PageHeader fed by `usePageHeader()` from `@/shell/header`, breadcrumb derived from
  the registry, lazy page registration via `load` in `pages.ts` with a route progress bar + skeleton, page transition
  on the content column only, StatePanel no-access and not-found (with Go to home), ToastProvider around the app,
  `--ds-sticky-top` published for table headers, print stylesheet hides sidebar and actions.
  Run: `cd web && npm install && npm test` (115 tests incl. a tokens-only lint over design/ and shell/),
  `npx tsc --noEmit`, `npm run build`, `npm run storybook` (:6006) or `npm run build-storybook`. Stories use the real
  program JSON in docs/dashboard-json and the R05 finding fixture; nothing invented.
  Stubbed: no page components (UI agents); FindingCard page crop is a slot the page fills from
  `/uploads/{id}/pages/{n}.png`. Not checked in a browser by me (no dev server reachable from my session); the
  Storybook build and jsdom tests pass. Needs: see Design System in docs/requests.md (package.json, .storybook owner,
  make check running the web suite).
- 2026-11-03 — Extraction: wave 1b seams (merged lead/wave1-seams). The page-2 NPV adjustment is emitted as
  `period_history[].charge_off`; `new_funded` and `ineligible_buyback` stay, positive amounts, only where the
  layout prints them (Moneda: charge_off; Stride: new_funded, ineligible_buyback; Xpedite: none). All 12
  extractions validate and close the new R05 identity within $1 (tested directly until Rules' checks.py lands).
  `worker/main.py handle()` calls validate's mark_extracting / handle_extraction / mark_failed, keeps writing
  `extraction-pass<n>.json`, and falls back to disk-only without the adapter; tests cover success, pass 2,
  extraction failure and hand-off failure with fakes, plus a `python main.py`-style import from worker/.
  Requirements: `worker/requirements.txt` (runtime) and `worker/requirements-dev.txt` (pytest, pypdf).
  Run: `pip install -r worker/requirements-dev.txt && python -m pytest -q worker/extract/tests`.
- 2026-11-03 — Extraction: wave 1 deliverables 1–6 on `agent/extraction`. `extract(pdf, template_id, pages=None)`
  in `worker/extract/` reads the text layer with pdfplumber (repairs Excel's phantom spaces inside numbers,
  detects negative signs by geometry, aligns blank cells by column edges), parses sections by heading through
  `templates/fpil-2.0-settrep-v1.yaml`, derives the dashboard fields (current period rows, ratio_history,
  cnl_by_period with limits, covenants with status/trend/utilization, summary, financial_ratios) and records a
  source (page, bbox, raw text) for every leaf. Result: the 3 F-PIL reference objects reproduced field for field
  from their PDFs (`history.chain` over the 4 reports per deal; tolerance $0.01 / 0.0001), every one of the 12
  PDFs matches its period's rows, all pass phase-1 rules with no block finding, and a copy of Moneda 202608 with
  one digit changed on page 2 fails R05 by exactly −100.00. Claude fallback (`ANTHROPIC_MODEL`) is asked only
  for unplaced cells, JSON-validated, every call logged; the 12 samples need none. Pass 2 re-reads named pages
  and returns a patch (`merge_patch` applies it). `worker/main.py` runs jobs and hands off to `worker/validate`.
  Run: `python -m pytest -q worker/extract/tests` (≈2 min; sample tests skip without `data/samples/`);
  `python -m worker.extract.compare <pdf> <reference.dashboard.json>`. Stubbed: OCR fallback (pages without
  text are listed in `meta.pages_without_text`), MOVE Trust template, the validate hand-off. Needs: see
  docs/requests.md › Extraction (pypdf, compose worker path, R05 extra terms, reference quirks).
- 2026-11-03 — Rules, wave 1b (seams): merged lead/wave1-seams. R09 resolves from rules.yaml (FN_FALLBACK gone).
  R05 adds `new_funded` (+) and `ineligible_buyback` (−) beside `charge_off`, named in context and message when
  non-zero; R18 checks `covenants[].reported_triggered` (YES ⇔ BREACH). New fixtures r05-new-funded,
  r05-ineligible-buyback, r18-reported-triggered (Moneda, SLFA 9.1 (h) answered YES at ICR 1.27 vs 1.10).
  `worker/validate` now owns the worker's database writes: `mark_extracting`, `handle_extraction` (extraction row,
  reporting_period, findings, pass-2 enqueue on retryable block findings or needs_review, pass-1 findings marked
  resolved_by_pass_2), `mark_failed` (status + audit row); opens its own transaction on DATABASE_URL when no
  connection is passed. `build_context` returns the API's override Context shape. Run: `cd rules && python -m pytest -q`
  (75), `cd worker/validate && python -m pytest -q` (12, SQLite). Not tested on PostgreSQL here (no libpq locally).
  Needs: worker/main.py to call the three functions (Extraction); AuditEntry.action decision; earlier open items
  (Stride/Xpedite covenant seed, deal facility limit, `make check` line).
- 2026-11-03 — Rules: every phase-1 and phase-2 rule implemented in `rules/checks.py` (R01–R15, R17–R19); R16 and
  R20–R22 (phase 3) not implemented. Each has `rules/tests/fixtures/<rule>-pass.json` / `-fail.json` (a real deal
  object plus one recorded change, generated by `make_fixtures.py`) and frozen expected findings under
  `fixtures/findings/`. On the 12 reference deals with seeded master data: no block findings except R05 on Finloc
  and TLFC LP (Meridian now closes: R05 subtracts its NPV adjustment `charge_off`); R18 reproduces every
  ceiling/floor status, worst_status and covenant_summary; one review finding pair (R14 on Stride, seed issue);
  one R19 note (Essex ICR OK → WATCH). `run()` over one deal ≈ 25–70 ms. `worker/validate/`: `SqlStore` +
  `validate_extraction(store, extraction_id)` builds prior / master / published periods / upload from the
  database, plus `retry_pages`, `resolved_by_pass_2`, `counts`, `insert_findings`. Run:
  `cd rules && python -m pytest -q` (72) and `cd worker/validate && python -m pytest -q` (6). Stubbed / limited:
  R02 has no report currency field to read except Finloc's by_currency; R10 and R17 compare multiples to the
  printed ratio history (no EBITDA / interest captured); R17 skips "(Definitions)" trigger tests; R15 lacks a
  deal-level facility limit; R18 cannot check page-14 YES / NO. Needs: see `docs/requests.md` › Rules (R09 `fn`,
  R05 / R18 / R03 wording, Stride/Xpedite covenant seed, deal facility limit, worker mount path, `make check` line).
- 2026-11-03 — Rules, wave 1c (history chaining): `handle_extraction(job, extraction, conn=None, enqueue=None,
  extend=None)`. With `extend`, the extraction is chained onto the prior publication (the same one build_context
  hands the rules as ctx.prior, via `prior_publication`) before it is validated and stored, so the stored row,
  the findings and a later approve all carry the full history. No prior: stored unchanged, extend not called.
  extend raises: logged, unchained document stored with a note in `meta.notes`, upload not failed. On all 12
  reference deals, the chained object against the previous month as prior raises no block or review finding the
  single-month extraction does not; R11's restatement check finds the chained earlier months equal to the prior.
  Chaining removes three R11 blocks (Dynamic, Essex, TLFC LP: opening gap = tranche funded since the prior) when
  the prior has no tranche list, because the chained `balance_discontinuities` explain the gap; with a prior that
  carries `all_tranches`, R11 explains them either way. Run: `cd rules && python -m pytest -q` (76),
  `cd worker/validate && python -m pytest -q` (16). Needs: Extraction's `worker/extract/history.py: extend`
  (main has only `chain`) and worker/main.py passing `extend=` to `handle_extraction`.
- 2026-11-03 — UI-Partner, wave 1: `web/src/portfolio/`. Portfolio Executive Summary (a card per program the caller
  may see: balance with change, utilization, covenant counts, deals flagged; flagged-deals table; Go to deal picker
  grouped by program), Program Executive Summary (tiles, escalations, a card per deal with OK / WATCH / BREACH and a
  link, prev / next program, period picker), Program Dashboard (Portfolio Metrics tiles and a deal table; Covenant
  Status & Review, one row per deal × covenant with status, value, threshold, utilization, trend; expand row →
  covenant detail with last period; Expand all / Collapse all; Flagged only; watch threshold pop-up, display only;
  Print / Save as PDF expands every row, prints, restores; print stylesheet), Deal page (Deal Metrics tiles,
  roll-forward, facility and contracts, balance history, aging by period, losses and CNL by vintage, borrower and
  portfolio ratios, covenant table with legal ref and description, ratio history as an inline SVG, one series,
  latest 13 months; prev / next deal; period picker) and, in the TAO Admin shell only, an upload strip (status of the
  period's upload, link to its review page, any newer upload). Data only from `/published/*` (plus `GET /uploads?deal_slug=`
  for the admin strip, admin shell only); 404 shows "You don't have access". Every number on screen carries its path
  in the published object (`data-field`). Tests: `cd web && npx vitest run src/portfolio` (55: the 12 deals and 2
  programs rendered and every displayed number read back against the reference files within $1 / 0.01 pp; states,
  access, navigation, dashboard controls, print, admin strip; tokens only). Over HTTP:
  `PF_LIVE_API=http://localhost:18300 npx vitest run src/portfolio/__tests__/live.test.tsx` (16, against a stack
  seeded with `--reference-publications`: all 12 deals and both programs equal the reference). Checked in a browser
  on :5176 against that stack. Print: width checked by applying the print rules at A4's 186 mm content width
  (no element overflows with all 98 MOVE Trust covenant rows expanded, about 14 pages); a real print to A4 / Letter
  was not run. Stubbed: admin program / dashboard / deal pages ride on query parameters until the nested admin routes
  exist; Reports, Report viewer and Data room are not built. Needs: see `docs/requests.md` › UI-Partner.
- 2026-11-03 — UI-Review, wave 1 (deliverables 1–3) on `agent/ui-review`. Registered in `web/src/shell/pages.ts` (load
  fields only). Approval queue (`/admin/uploads/queue`): needs_review (+ approved) uploads oldest first, deal and program
  names from master data, finding counts as severity pills, row or link opens the review. Review report
  (`/admin/uploads/queue/:uploadId`): header facts (deal, collection period with settlement date, reporting period,
  uploader, extraction pass and re-read pages, confidence, open/resolved counts); findings grouped block → review → note as
  FindingCards with the rule title from `contracts/rules.yaml`, the page image fetched with the role headers, centred on the
  report-value cell and outlining every cell the rule read (bboxes from `sources`), click for a page viewer with
  Fit/100/150/200 % and previous/next page; per-card Use ours / Use report / Accept as restatement / Acknowledge for
  `tao_admin`, each requiring a reason, then the findings refresh from the override response. Extracted values panel:
  balances, month-by-month roll-forward, contracts, aging, CNL by vintage, covenants, financial ratios and ratio history,
  each value or row with a page link (opens the viewer on that cell with its raw text) or "from published Jul 2026" for
  carried months. Activity table from `/audit` (admin only). Sticky footer: Re-extract pages… (pages with open findings
  preselected, then 2 s polling until the pass settles), Reject… (reason), Publish to partner… (disabled with the reason
  while a block is open; shows the API's 409 if it refuses). Analysts see everything read-only; partner roles get "no
  access" and no intake request. Reports library (`/admin/reports`): published uploads by program, deal and period with
  filters, Partner view and Review record links, Regenerate dashboard pop-up (all programs or one).
  Verified against the private stack (tao-ui-review, :18200 via Vite on :5175): the walkthrough ran in a browser and again
  over HTTP — R05 block on page 2 (−$100.00) with its crop, override use_ours with a reason, finding overridden and
  publish enabled, approve → published, `/audit` has the override with ours 15,020,071.52 and report 15,019,971.52; analyst
  403 on override/approve, approve 409 while blocked. Run: `cd web && npx vitest run src/review` (45 tests; fixtures are
  recorded real API responses). Needs: see docs/requests.md › UI-Review (percent_points formatting, narrow FindingCard,
  admin deal route for Partner view, override-vs-published question, MSYS path note).
- 2026-11-03 — UI-Admin, wave 1 (all five work packages): eight pages in `web/src/admin/`, registered in
  `web/src/shell/pages.ts` (`load` only). Upload report: deal (grouped by program) and collection period first, then
  the PDF; after upload it shows the collection period as entered and the reporting period read from the report,
  the status pill and steps moving received → extracting → needs review with 2 s polling (stops at needs review or
  any other settled state), finding counts, an R04 note when the two dates are not one month apart, a review link,
  and plain-language 409 / 422 / 403 errors. Uploads: four queue tiles (received, extracting, needs review, published
  this month) and the ten latest uploads. Upload history: deal / period / status filters kept in the URL, status
  pill, block / review / note counts, who / when, Review and Audit links. Dashboard: Programs, Deals, Flagged deals
  (worst status BREACH or WATCH) from `/published/portfolio`, covenant totals by program, the queue tiles, latest
  uploads; empty state when nothing is published. Partners → Partner details → Program / facility record: limits,
  deals with template id, covenant definitions with single or banded thresholds, watch buffer, effective date,
  version state (in force / superseded / scheduled) and source; `tao_admin` edits programs, deals and covenants
  (edit in place or add a new version) through the PUT routes; other roles get a read-only view. Audit log: upload
  filter (API) and action filter, expandable detail, deep link `?upload_id=` from Upload history. Every page has
  loading, empty, error (with retry) and no-access (any 403) states. Run: `cd web && npx vitest run src/admin`
  (53 tests, `api()` mocked); dev against a private stack: `MSYS_NO_PATHCONV=1 VITE_PORT=5174
  VITE_API_PROXY=http://localhost:18100 VITE_API_URL=/api/v1 npx vite`. Verified: the upload journey against Prism
  (static examples, so status stays `received`) and against the real stack as `tao_analyst` in the browser
  (received → extracting → needs review in about 14 s, reporting period 2026-06 for a 2026-07 PDF filed as 2026-10,
  R04 note shown, 4 block findings, polling stopped); PUT program / deal / covenant on the real API with the
  dialogs' bodies, then the master_change entries in the Audit log. Lighthouse accessibility 96 on Upload report and
  Upload history (only failure: Design System colour contrast). Needs: see `docs/requests.md` › UI-Admin.
- 2026-11-03 — QA & Demo: Playwright suite in `tests/e2e/` (own package.json + lockfile, @playwright/test 1.56.1,
  lighthouse 13.5.0). Projects: `setup` (stack up, seeded, fresh; seeded-error PDF via `scripts/demo_data.py`; May–Jul
  published for Moneda, Xpedite, Stride through the API), `demo` (steps 1–7 of the build plan's demo script, each
  switching role through the sidebar user card and asserting on visible text and on API state with the role-header
  client, plus negatives: analyst 403, publish 409 while R05 is open, partner tenancy by URL and API, partner and analyst
  on TAO routes, blank PDF → extraction_failed), `wave3` (manager sees both programs, /master/partners, covenant unit,
  Use ours writes 15,020,071.52 with data_corrections; expected red until merged). Result from `docker compose down -v`
  on the QA stack: 16/16 green in 8 min (a second clean run lost step 4 to the API page-image crash filed to Data & API, the rest green after an API restart); wave3 4/4 red for the expected reasons. `docs/demo.md` is the walkthrough with
  27 screenshots in `docs/demo/` and the acceptance table measured (Xpedite deal page: 154 numbers, 0 mismatches against
  the shared dashboard; upload to needs review 6–32 s; Lighthouse 93–96; full demo 11 min 17 s, over the 10-minute
  target). Run: see `docs/demo.md` › Run it. Stubbed: step 6's covenant toast (not built, no data) and step 7's
  re-upload (API refuses, R12). Needs: see `docs/requests.md` › QA & Demo.
- 2026-11-03 — UI-Partner, wave 3: merged integration/wave3. Admin-shell portfolio links now use the nested routes
  (`/admin/portfolio/:programId`, `/dashboard`, `/deals/:dealId`); tests updated. Router links use `<Button as="link">`;
  my KPI minimum width is gone (tiles no longer ellipsize). Deal page: "Data corrections" section from `deal.data_corrections`
  only (six MOVE Trust reference deals carry one each). Ownership per program_partner: both partners see both programs; an
  unknown program (404) shows "You don't have access". Tests: `cd web && npx vitest run src/portfolio` 60 passed (17 live
  tests skipped without PF_LIVE_API); live against tao-ui-partner seeded with `--reference-publications`: 17 passed. Browser
  check on :5176: manager sees MOVE Trust Dynamic Capital with its correction; admin nested dashboard links to nested deal routes.
  Known red test outside my folder: UI-Review ReportsLibraryPage "deepest registered portfolio route" (see requests).
- 2026-11-03 — Data & API: wave 3b. Merged agent/rules (7d05e5b, findings carry `targets`). Override re-runs refresh
  `targets`. Approve plans every resolved use_ours / use_report write first: different values for one pointer → 409
  `conflicting_corrections`; equal values are written once. After writing, if anything changed, the rules re-run on the
  corrected deal and any block finding no resolved finding covers → 409 `correction_inconsistent`; derived fields are not
  hand-computed. Seeded demo: use_ours writes 15,020,071.52 to all five R05 targets, the R05 identity holds on the
  published deal (opening − components = 15,020,071.52) and approve succeeds; use_report changes nothing. Also normalised
  my files back to LF (earlier edits had written CRLF). 125 API tests pass on SQLite and PostgreSQL.
- 2026-11-03 — Data & API: wave 3. Merged main (e20ce7d) and lead/wave3. Multi-partner programs: `ProgramPartner` model over
  004; Program and Upload return `partner_slugs` (partner_slug = the first); `visible_programs` reads program_partner, so the
  manager now sees MOVE Trust and F-PIL and a partner not listed gets 404. `PUT /master/programs` takes `partner_slugs` (or
  `partner_slug` alone) and audits. New `GET /master/partners`; `CovenantDefinition.unit` on GET/PUT; `GET /uploads?collection_period=`
  and `GET /audit?action=`. Overrides: use_ours / use_report need `targets` (else 409 `no_target`); approve writes the chosen
  value to every target in the published deal (the extraction is untouched) and appends one `data_corrections` entry per
  changed pointer, listed in the approve audit detail. Migration 005 adds `finding.targets`. Seed loads `partner_slugs` and
  `unit` idempotently. 122 tests pass on SQLite and on PostgreSQL 16 built from db/migrations 001-005. Waiting on Rules:
  adapter must write `targets`, and the r02 fixture needs regenerating after the seed patch (see requests.md).
- 2026-11-03 — Rules, wave 3 (override targets): findings carry `targets` (finding.schema.json) where use ours /
  use report should change the published value. Each target is the field plus every other copy of the same number
  in the deal (to the cent for money, exact for counts and ratios); the current period row is found by
  collection_period, so pointers are right in single-month and chained objects. Tests: every target in every
  fixture, and in all 12 reference deals as single-month and chained objects with seeded errors, resolves to
  report_value; writing our_value to the targets makes the finding go away. `insert_findings` writes `targets` when
  the finding table has the column (it does not yet: see requests.md). Run: `cd rules && python -m pytest -q` (80),
  `cd worker/validate && python -m pytest -q` (17).

  | Rule | Finding | targets | Why |
  | --- | --- | --- | --- |
  | R01 | field missing | none | nothing to choose between |
  | R02 | currency vs facility | none | text, master data |
  | R03 | value out of range | none | no our_value to write |
  | R04 | periods | none | months, other period |
  | R05 | roll-forward | current `period_history[i].closing_balance` + copies: `tranche_balance.closing`, `period_history[i].closing_amount`, `tranche_amount.closing`, `program.program_amount` | our_value = computed closing (Lead decision) |
  | R05 | page-2 vs roll-forward row | `tranche_balance.opening` or `.closing` | our_value = the row's figure for the same field |
  | R06 | contracts roll-forward | `contracts.closing` + `period_history[i].closing_contracts` when equal | our_value = opening + change |
  | R06 | top-mover row | `contracts.top_movers[j].closing_contracts` | same, per tranche |
  | R06 | movers exceed net decrease | none | aggregate, no single field |
  | R07 | aging buckets | `aging_history[0].closing_balance` | our_value = bucket sum |
  | R08 | vintage gross − recoveries | `cnl_by_period[i].cumulative_net_losses` | our_value = computed CNL |
  | R08 | vintage ratio | `cnl_by_period[i].cnl_ratio_reported_pct` if stored, else `.cnl_ratio_pct` | the field report_value came from |
  | R08 | vintage total vs page 11 | `aging_history[0].cumulative_net_losses` | our_value = vintage sum |
  | R09 | unused / utilization | `program.unused_facility` / `program.program_utilization_pct` | recomputed from limit and drawn |
  | R10 | enhancement % | `total_enhancement.total_enhancement_pct` | recomputed |
  | R10 | coverage / leverage / equity | `financial_ratios[k].value` + same-number covenant `current_value`s | our_value = the ratio-history row |
  | R11 | opening vs prior, restatements | none | other period; restatement is accept / reject |
  | R12, R13 | published period, wrong deal | none | not a value |
  | R14, R15 | thresholds, limits | none | master data |
  | R17 | covenant recompute | `covenants[i].current_value` + same-number copies (other covenants on the metric, `financial_ratios`) | our_value = recomputed |
  | R18, R19 | status, YES/NO, summary, status change | none | statuses / text |
- 2026-11-03 — Design System: wave 3 fixes on `agent/design` (merged main e20ce7d and lead/wave3 72c66e8).
  (1) `percent_points` findings are fractions: formatByUnit / formatDiffByUnit multiply by 100, so Stride R14 reads
  ours 4.00%, report 3.50%, difference −0.50 pp, tolerance ±0.00%; context fractions follow, context amounts in a
  percent_points finding (R10 enhancement_amount, base) stay plain numbers. (2) FindingCard is a size container: under
  680 px the values go to two columns and the page crop moves below them; the values never overlap. (3) Contrast, WCAG
  AA (4.5:1), hues kept and darkened (ratios are the worst case over the listed surfaces):

  | Token | Surfaces | Old | Old ratio | New | New ratio |
  | --- | --- | --- | --- | --- | --- |
  | `--muted` | cream, card, canvas-deep, lav | #8b8597 | 3.09:1 lav, 3.43:1 cream, 3.56:1 card | #6e687a | 4.64:1 lav, 5.15:1 cream, 5.35:1 card |
  | `--ok` (pill word) | ok-bg, cream, card | #1f9d6b | 3.07:1 (ok-bg) | #187b54 | 4.67:1 (ok-bg) |
  | `--warn` (pill word) | warn-bg, cream, card | #bd7a18 | 3.12:1 (warn-bg) | #976113 | 4.60:1 (warn-bg) |
  | `--bad` (pill word) | bad-bg, cream, card | #d24b46 | 3.57:1 (bad-bg) | #be332e | 4.66:1 (bad-bg) |
  | `.navlabel` → new `--text-on-indigo-muted` | indigo, indigo-2 | color-mix = #8c86b3 | 4.04:1 (indigo) | #a49fc3 | 5.45:1 indigo, 4.67:1 indigo-2 |
  | `--blue`, `--dpv` (unchanged) | own -bg, cream, card | #2f5fd0, #6a37d8 | 5.00:1, 5.57:1 | same | same |

  New token `--line-on-indigo` (sidebar hairline, decorative). A test recomputes every pair from tokens.css.
  (4) KpiTile values never ellipsize: font size follows the tile width (clamp 16 px to --fs-kpi, container units),
  then wraps. (5) pages.ts: admin routes `/admin/portfolio/:programId`, `/dashboard`, `/deals/:dealId` (owner
  portfolio, no nav); `tao_analyst` on Partners, Partner details, Program record. (6) `apiBlob(path)`, `roleHeaders()`
  and `API_BASE` in shell/api.ts; `Button as="link" to` (router) and `as="a" href`, disabled renders an aria-disabled span.
  Tests: web 303 passed, 16 skipped, 2 failed — both are UI tests that pin the pre-registration fallback (see
  docs/requests.md, To UI-Partner / To UI-Review). api 112 passed, 1 failed (`/master/partners` parity, pre-existing).
  Not checked in a browser by me; layout fixes rely on container queries (supported in current Chrome, Edge, Firefox, Safari).
- 2026-11-03 — UI-Review, wave 3 (corrections) on `agent/ui-review`, merged with integration/wave3. Override dialog: Use
  ours / Use report only when the finding has `targets` (otherwise disabled on the card and in the dialog, with the reason);
  for a value choice it says what publishing does ("Writes $15,020,071.52 to 5 fields: Roll-forward Aug 2026 · closing
  balance, Tranche balance · closing, …", pointers as readable labels; "Nothing changes" when the extraction already holds
  the value); R05 / R07 add the hint that Use report is right when a component was misread. Resolved value choices show
  "Pending on publish" (then "Published") on the card. Publish dialog lists the corrections approve will write (field,
  extracted, published, rule and choice) and shows 409 `conflicting_corrections` (field, both values, rules) and
  `correction_inconsistent` (the new block findings) with "Go to R0x" buttons that close the dialog and focus the card.
  Page images use `apiBlob`; link-buttons use `<Button as="link">`. Verified live (tao-ui-review, migrations 004/005 on a
  fresh volume): use ours on the seeded R05 → published closing 15,020,071.52 with five `data_corrections` entries (period
  history closing balance and amount, tranche balance closing, tranche amount closing, program amount); after a reset, use
  report → published closing 15,019,971.52, no `data_corrections`, approve audit `corrections: []`; analysts see no buttons;
  Stride R14 (no targets) shows use ours / use report disabled. Run: `cd web && npx vitest run src/review` (52 tests).
- 2026-11-03 — UI-Admin, wave 3 follow-ups: Partners and Partner details read `/master/partners` (real names, kind,
  status; a partner without programs shows, with "None yet"); a program counts for every partner in `partner_slugs`
  (older API: `[partner_slug]`). Program record shows "Visible to", and `tao_admin` edits it in the program dialog
  (a checkbox per partner, at least one required, `partner_slug` = first checked). Covenant thresholds format by
  `unit` (fraction / ratio / currency), old guess only when `unit` is null; the covenant dialog has a Unit select
  and sends `unit`. Upload history sends `collection_period` and the Audit log sends `action` to the API (client-side
  filtering removed). Live on the tao-ui-admin stack (fresh volumes, seed, `--profile admin`): tao_analyst sees all
  three Partners pages read-only (note, no edit controls); tao_admin unchecked Manager on F-PIL 2.0 in the dialog,
  the API returned `partner_slugs: ["investor"]`, Manager's details page then listed only MOVE Trust and the
  Manager program URL for F-PIL showed "No such program"; restored through the dialog. Lighthouse accessibility 100
  on Upload report and Upload history. Run: `cd web && npx vitest run src/admin` (58 tests).
- 2026-11-03 — Rules, corrected re-issues: R12 on an upload with `replaces_upload_id` still blocks, with "Corrected
  re-issue: replaces the {period} report published {published_at}." and, when later months are published, "Later
  published months (...) still carry the earlier figures for {period}." Context has replaces_upload_id, published_at,
  later_periods; no targets (acknowledge with a reason, or reject). A plain duplicate keeps its message. The
  worker's `build_context` reads `replaces_upload_id` once migration 006 adds the column (absent: None), and passes
  `published_periods` as {period: published_at} so the message carries the date. History chaining on a re-issue
  uses the last publication before the period (`prior_publication`, strict <), never the one being replaced; tested
  end to end. Fixtures r12-reissue and r12-reissue-later. Run: rules 84, worker/validate 19.
- 2026-11-03 — Data & API: page-image crash fixed. PDFium is not thread-safe and concurrent first renders killed the
  uvicorn process silently. `api/app/pdf.py` puts every PDFium open, render and save (page counting on upload included)
  under one process-wide lock, and writes each PNG to a temp file in the page folder before `os.replace`. Burst of 12
  parallel requests for pages 3-8 on a private stack: before, 1 of 4 bursts killed the server (health timed out) and
  others served 11 valid PNGs of 12; after, 6 of 6 bursts gave 12/12 valid PNGs with health 200. New
  tests/test_page_concurrency.py; 128 API tests pass on SQLite and PostgreSQL.
- 2026-11-03 — Data & API: corrected re-issues. `POST /uploads` takes `replace`; a published period without it is still
  409 `already_published`, `replace` with no publication is 422 `nothing_to_replace`, and with one the upload records
  `replaces_upload_id`. Approve swaps the publication row to the new upload (rollup_version + 1, publish audit names
  `replaced_upload_id`); the old upload stays `published` and reports `replaced_by_upload_id` (derived). Migration 006 adds
  the column and stops a `published` upload counting as the period's active upload, so the re-issue can be uploaded while
  one-in-flight still holds. The Upload dict in the override Context carries `replaces_upload_id`. 133 API tests pass on
  SQLite and PostgreSQL (migrations 001-006).
- 2026-11-03 — UI-Review, corrected re-issues (merged integration/wave3 fbb7d41). Review page: a banner on a re-issue
  ("Corrected re-issue of Moneda Capital Corp. Jul 2026. Publishing replaces the report published …", link to the replaced
  upload's review record) with the later-months warning from R12's `later_periods`; past tense once published; on a
  replaced upload a note and footer link to the re-issue. R12 card on a re-issue: one primary "Accept as replacement"
  (acknowledge + reason; the dialog relabels Acknowledge and hides the empty ours/report values). Publish dialog: "Replaces
  the report published …" plus the later-months note. Queue tags re-issues; Reports library shows "Re-issue" / "Replaced"
  status, "Replaces earlier report" / "Replaced by re-issue" links, and no Partner view link on a replaced row. Verified
  live (tao-ui-review, fresh volume): published Moneda Aug, re-uploaded Moneda 2026-07 with replace=true → R12 "replaces
  the 2026-07 report published … Later published months (2026-08) still carry the earlier figures for 2026-07"; Accept
  as replacement + publish in the browser → old upload `replaced_by_upload_id` = the re-issue, publish audit
  `replaced_upload_id` = the old one. Tests: `cd web && npx vitest run src/review` (62; Reissue.test.tsx on recorded responses).
- 2026-11-03 — UI-Admin, corrected re-issues: Upload report turns 409 `already_published` into a confirm dialog
  ("{deal} {period} is already published (on {date}). Upload this file as a corrected re-issue? ...") whose primary
  button resends with `replace=true`; when the chosen deal + period already has a published upload (looked up with
  `GET /uploads?deal_slug&collection_period&status=published`) the form also offers a "This is a corrected re-issue"
  checkbox; 422 `nothing_to_replace` reads as a plain sentence; the progress card says what the re-issue replaces.
  Uploads, Upload history and the Dashboard list tag "Re-issue" (`replaces_upload_id`) and "Replaced by re-issue"
  (`replaced_by_upload_id`), both linking to Upload history for that deal and period. Live (tao-ui-admin, fresh
  volumes, seed, `--profile admin`): re-issued Moneda 2026-08 through the UI via the 409 → confirm path; it reached
  needs_review in about 25 s with `replaces_upload_id` = the published upload and one R12 block ("Corrected re-issue:
  replaces the 2026-08 report published ..."); after acknowledge + approve over the API the history showed
  "Re-issue" on the new upload and "Replaced by re-issue" on the old one. Run: `cd web && npx vitest run src/admin` (63).
- 2026-11-03 — Data & API: the override re-run Context passes `published_periods` as {collection_period: published_at}
  like worker/validate, so a re-run R12 names the publication date. Test in tests/test_reissue.py; 134 API tests pass on
  SQLite and PostgreSQL.
- 2026-11-03 — QA & Demo, final round on integration/wave3: wave-3 assertions folded into the demo (step 3 manager sees
  the same Xpedite numbers; `specs/03b-master-data.spec.ts` partners and covenant unit; step 5 Use ours publishes
  15,020,071.52 with data_corrections), step 7 rewritten as a corrected re-issue of Moneda 2026-05 (confirm → R12 →
  Accept as replacement → publish → replaced_by → regenerate → partner page), toast clause removed, tenancy negatives
  add unknown / missing X-Partner, setup publishes 7 history months instead of 9. Two clean runs from `down -v`:
  18/18 and 18/18, 5 min 16 s and 4 min 43 s including start and seed. Lighthouse 100 / 96 / 100 / 100. docs/demo.md
  and its screenshots are current. Needs: see `docs/requests.md` › QA & Demo (resolved-card contrast, R12 message
  timestamp, five stale screenshots).
- 2026-11-04 — Rules: merged lead/covenants. With Stride's and Xpedite's own definitions, R14 raises nothing on
  the 12 reference deals (the Stride pair was the seed copy); Xpedite's ARFA refs are now compared, banded 9.1 (b)/(c)
  included. R14 skips a definition with no threshold and no threshold_rule (Stride 9.1 (g), per vintage). Fixtures
  unchanged (r14/r15 are Moneda). Rules 86, worker/validate 19. The Stride/Xpedite seed request in requests.md is resolved.
- 2026-11-04 — Lead: Stride and Xpedite covenant definitions replaced (branch lead/covenants). They were copies of
  Moneda's. Now from each 2026-08 report's covenant page, marked UNVERIFIED: Xpedite ARFA dated 2022-10-14, 9.1 (b)/(c)
  banded 6%/3% and 4%/2% on NPV ≤ / > $10M, (d) 3.0%, (f) CNL 2.75%, (e) ICR ≥ 1.10, (g) leverage ≤ 10, (h) equity
  ≥ $3,000,000. Stride SLFA dated 2021-02-05, amended 2026-01-22 (footnote, page 11): (d) 3.50%, (e) 2.50%, (f)
  3.5%, effective 2026-01-22 (pre-amendment values are not printed); (g) CNL is per vintage (3.50% for Sept 2021 -
  Aug 2022, 2.75% otherwise), so no scalar threshold; R08 checks it per vintage. R14 now raises nothing on the
  three F-PIL reference deals (Stride had two false reviews; Xpedite was never compared). 21 -> 18 definitions.
- 2026-11-04 — Data & API: merged lead/covenants (18 definitions; Stride and Xpedite have their own). `PUT /master/covenants`
  now accepts a definition with both threshold and threshold_rule null (Stride SLFA 9.1 (g), limit per vintage); the seed
  test counts the seed files instead of literals. Re-seeding an existing database leaves the 3 retired Stride/Xpedite rows
  in place (no superseded flag in the model; see requests.md). 135 API tests pass on SQLite and PostgreSQL.
- 2026-11-04 — Rules, wave 2b (R11 FX, robustness): merged main (5b0edb1). R11 compares multi-currency deals per
  currency: when both objects carry by_currency, each currency's native opening is checked against its native prior
  closing (USD from usd_closing_raw, or from the CAD equivalent ÷ spot_rate) within tol.currency. The CAD-equivalent
  gap is revaluation, kept in context. Single-currency deals are unchanged. Finloc May–July raise no R11 (revaluation
  +64,124.04, +106,968.53, −47,609.31; native gaps 0.00, and the reference May USD cent is absorbed). A native break
  still blocks (fixture r11-fx-revaluation). Essex May's restatement still blocks. R05 and R07 now return a block
  finding naming null terms ("Cannot check: … missing … pass 2 or review") instead of raising a TypeError.
  engine.run turns any check that raises into a finding (block, or review for note rules), so a rule can no longer
  mark an upload extraction_failed. Over the 36 MOVE extractions: R11 ×4 (Essex May ×2, TLFC LP June ×2), R19 notes ×8,
  nothing else. Tests: rules 122, worker/validate 19, check_contracts green.
- 2026-11-04 — Rules, wave 2c (corrected MOVE references): merged lead/move-fixes. KNOWN_ROLLFORWARD_GAPS is now empty
  in test_engine.py and test_rules.py. All 12 reference deals pass every phase-1/2 rule with no block, and R05 closes on
  every period_history month of TLFC LP, Finloc and Meridian as the references stand. Fixtures were regenerated from the
  corrected references. r05-adjustment-increase / r05-charge-off-move now pass unchanged, and each fail case drops the
  one amount (the old gap: +2,782.68 / −4,163.85). A sign-lost read is tested separately (twice the amount). The R11
  Finloc tests hold: by_currency is unchanged and July's −47,609.31 is still revaluation. Tests: rules 123,
  worker/validate 19, api 135, check_contracts green.
- 2026-11-04 — Data & API: latest-month program view (merged main 9ce35c8 and lead/latest-month cb12a95). For month P
  (requested, or the newest collection_period across the program's publications) each deal contributes its latest
  publication with collection_period <= P; deals with nothing at or before P are left out. `deals_behind`
  ({deal_slug, deal_name, as_of}) lists the deals contributing an earlier month, on /published/programs/{slug} and on
  each /published/portfolio program entry; [] when all are current. available_periods, the deal endpoint and
  rollup.build_program are unchanged. A requested month not in available_periods (e.g. ?period=2026-09) is 404,
  so no month is built only from older reports (Lead's decision). Also `failure_reason` on the Upload dict: read from the audit row that
  failed the upload (worker/validate mark_failed reason, or 'queue unavailable'); null unless extraction_failed. No
  migration, no worker change. Needs from Lead: `failure_reason` on the Upload schema in contracts/openapi.yaml.
  Tests: api 141, check_contracts green.
- 2026-11-03 — Lead: day-0 scaffold. Contracts (OpenAPI 19 routes, extraction + finding schemas, 22 rules as
  data, tokens, motion), compose with five services, API role gates with tests, rules engine with R01/R05/R07 and
  reference-data tests, web shell with role switcher and every portal-map page routed, seed data, agent briefs.
  Findings from real data: F-PIL and six MOVE Trust deals close their roll-forward to the cent; three MOVE Trust
  deals do not (see rules tests); two aging conventions exist.
