# Progress log

Append an entry when a work package lands. Newest first.

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
- 2026-11-03 — Lead: day-0 scaffold. Contracts (OpenAPI 19 routes, extraction + finding schemas, 22 rules as
  data, tokens, motion), compose with five services, API role gates with tests, rules engine with R01/R05/R07 and
  reference-data tests, web shell with role switcher and every portal-map page routed, seed data, agent briefs.
  Findings from real data: F-PIL and six MOVE Trust deals close their roll-forward to the cent; three MOVE Trust
  deals do not (see rules tests); two aging conventions exist.
