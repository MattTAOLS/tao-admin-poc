# Progress log

Append an entry when a work package lands. Newest first.

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
- 2026-11-03 — Lead: wave-1 seam decisions (branch lead/wave1-seams). Roll-forward terms: `charge_off` is the one
  name for the page-2 NPV adjustment (column i), already in the reference data; `new_funded` (+) and
  `ineligible_buyback` (−) are new optional period_history fields, all positive amounts. R05 is now opening +
  new_funded − principal − prepayments − losses − charge_off − ineligible_buyback. `covenants[].reported_triggered`
  (YES/NO) is in the schema and R18 uses it. rules.yaml also takes Rules' R03 range, R09 fn and R18 floor band.
  Compose: worker runs `python main.py` from /app (imports `extract`, `validate`, `rules`); api mounts
  docs/dashboard-json for the demo seed. Worker hand-off: worker/validate owns every database write
  (`mark_extracting`, `handle_extraction`, `mark_failed`); worker/main.py calls them.
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

- 2026-11-03 — Lead: day-0 scaffold. Contracts (OpenAPI 19 routes, extraction + finding schemas, 22 rules as
  data, tokens, motion), compose with five services, API role gates with tests, rules engine with R01/R05/R07 and
  reference-data tests, web shell with role switcher and every portal-map page routed, seed data, agent briefs.
  Findings from real data: F-PIL and six MOVE Trust deals close their roll-forward to the cent; three MOVE Trust
  deals do not (see rules tests); two aging conventions exist.
