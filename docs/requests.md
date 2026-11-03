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
## Rules
## UI-Admin
## UI-Review
## UI-Partner
## QA & Demo
