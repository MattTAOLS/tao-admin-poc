# Progress log

Append an entry when a work package lands. Newest first.

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
- 2026-11-03 — Lead: day-0 scaffold. Contracts (OpenAPI 19 routes, extraction + finding schemas, 22 rules as
  data, tokens, motion), compose with five services, API role gates with tests, rules engine with R01/R05/R07 and
  reference-data tests, web shell with role switcher and every portal-map page routed, seed data, agent briefs.
  Findings from real data: F-PIL and six MOVE Trust deals close their roll-forward to the cent; three MOVE Trust
  deals do not (see rules tests); two aging conventions exist.
