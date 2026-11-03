# Design System agent — `web/src/design/` and `web/src/shell/`

Goal: every component the three UI agents need, in Storybook, built on `contracts/tokens.css` and
`contracts/motion.md`, matching the look of `docs/design/redesign_mockup.html` (cream canvas, indigo sidebar,
purple primary, Plus Jakarta Sans + Inter, deep purple-tinted shadows). You also own the shell in
`web/src/shell/` (sidebar, top bar, role switcher, page registry, API client) which the Lead has stubbed.

Deliver (wave 1, days 1–4), in this order because the UI agents are waiting on it:
1. `components/`: Button (primary, ghost, danger), StatusPill (ok / warn / bad / blue / dpv, dot + word),
   Card, KpiTile (big number, label, one-line context, as in the mockup), DataTable (sticky header, numeric
   columns right-aligned with tabular numerals, row expand, empty state, loading skeleton), FindingCard
   (rule id, severity pill, message, ours vs report with difference, page-crop slot, action slot), Field
   (label, input/select/textarea, error), FileDrop, Toast (bottom-right, 6 s), Dialog (Escape closes),
   Breadcrumb, SkeletonBlock, PageHeader.
2. Storybook with every component in every state; keyboard navigation and visible focus everywhere.
3. Shell polish: page transition per motion.md, "no access" and "not found" states, the role switcher in the
   sidebar footer as in the mockup's user card, nav grouping (Workspace / Account).
Done when: every component is in Storybook in all states, `npm run build` and `npx tsc --noEmit` pass, and the
three UI agents can import from `@/design/components` without asking you anything.

Do not: build pages (UI agents), call the API from components (pages do that), add a CSS framework or icon set
beyond inline SVG, use any colour that is not a token.

## Rules every agent follows

- Work only inside your folder(s) listed above. If you need something elsewhere, write it down in `docs/requests.md` under your agent name and tell the Lead; do not edit another agent's folder or anything in `contracts/`.
- Build against the contracts, not against another agent's code: `contracts/openapi.yaml`, `contracts/extraction.schema.json`, `contracts/finding.schema.json`, `contracts/rules.yaml`, `contracts/tokens.css`, `contracts/motion.md`. UI agents run `make mock` (Prism on :8001) until the real API is merged.
- Branch: `agent/<your-name>` off `main`. Commit small and often with messages that start with your agent name, e.g. `rules: R11 opening equals prior closing`. Never commit to `main`; never commit `.env` or anything under `data/`.
- Before every commit: your own tests pass, and `make check` passes from the repo root (it validates the contracts and the reference data). If `make check` fails because of your change, fix your change.
- Real data lives in `docs/dashboard-json/` (12 deals, 2 programs) and the SetRep PDFs the Lead places under `data/samples/` (git-ignored). The field inventory is `docs/dashboard-json/SCHEMA.md`. Never invent numbers; fixtures are copies of real objects with one deliberate change.
- Reads before writes: `docs/portal-map.md` (pages, roles, routes), `docs/validation-strategy.md` (rules, workflow), the build plan sections quoted in your brief.
- Design: tokens only, never raw colours; dense tables where the data is (13 px Inter, tabular numerals, right-aligned numbers, sticky header); status is always a dot plus a word. Motion per `contracts/motion.md`.
- When done with a work package, append a short entry to `docs/progress.md`: what is built, how to run it, what is stubbed, what you need from others.
