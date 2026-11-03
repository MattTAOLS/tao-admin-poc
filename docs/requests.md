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
## Extraction
## Rules
## UI-Admin
## UI-Review
## UI-Partner
## QA & Demo
