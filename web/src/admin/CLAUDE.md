# UI-Admin agent — `web/src/admin/`

Goal: the TAO Admin pages marked `built: true` and owned by `admin` in `web/src/shell/pages.ts`: Dashboard,
Uploads, Upload report, Upload history, Partners, Partner details, Program / facility record, Audit log.
Register your components in `pages.ts` by replacing the placeholder for each route (coordinate the one-line
edit with the Design System agent, who owns `shell/`).

Deliver (wave 1, days 2–6):
1. Upload report: choose deal (grouped by program) and collection period first, then drop the PDF; after upload
   show both dates the API returns (collection vs reporting period) and the status chip moving
   received → extracting → needs_review with 2 s polling; link to the review page when findings exist.
2. Uploads: queue summary tiles (received, extracting, needs review, published this month) and the recent list.
   Upload history: table with filters (deal, period, status), status pill, finding counts, who/when.
3. Dashboard: KpiTiles from `/published/portfolio` (programs, deals, flagged) and the queue tiles; nothing
   invented — if the API has no data, show the empty state.
4. Partners → Partner details → Program / facility record: limits, deal list with template id, covenant
   definitions table with threshold or threshold_rule bands, effective_from and source; edit via PUT routes
   (`tao_admin` only; analysts see read-only).
5. Audit log: table from `/audit` with filters by upload and action.
Done when: the journey "TAO analyst uploads a report" (docs/portal-map.md, Journeys) runs against the mock
and against the real API, every page has empty / loading / error / no-access states, and Lighthouse
accessibility ≥ 90 on Upload report and Upload history.

Do not: build the review or publish screens (UI-Review), restyle components (Design System), call the model.

## Rules every agent follows

- Work only inside your folder(s) listed above. If you need something elsewhere, write it down in `docs/requests.md` under your agent name and tell the Lead; do not edit another agent's folder or anything in `contracts/`.
- Build against the contracts, not against another agent's code: `contracts/openapi.yaml`, `contracts/extraction.schema.json`, `contracts/finding.schema.json`, `contracts/rules.yaml`, `contracts/tokens.css`, `contracts/motion.md`. UI agents run `make mock` (Prism on :8001) until the real API is merged.
- Branch: `agent/<your-name>` off `main`. Commit small and often with messages that start with your agent name, e.g. `rules: R11 opening equals prior closing`. Never commit to `main`; never commit `.env` or anything under `data/`.
- Before every commit: your own tests pass, and `make check` passes from the repo root (it validates the contracts and the reference data). If `make check` fails because of your change, fix your change.
- Real data lives in `docs/dashboard-json/` (12 deals, 2 programs) and the SetRep PDFs the Lead places under `data/samples/` (git-ignored). The field inventory is `docs/dashboard-json/SCHEMA.md`. Never invent numbers; fixtures are copies of real objects with one deliberate change.
- Reads before writes: `docs/portal-map.md` (pages, roles, routes), `docs/validation-strategy.md` (rules, workflow), the build plan sections quoted in your brief.
- Design: tokens only, never raw colours; dense tables where the data is (13 px Inter, tabular numerals, right-aligned numbers, sticky header); status is always a dot plus a word. Motion per `contracts/motion.md`.
- When done with a work package, append a short entry to `docs/progress.md`: what is built, how to run it, what is stubbed, what you need from others.
