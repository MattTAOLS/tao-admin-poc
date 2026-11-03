# web — React + Vite, two shells, one component library

- `src/shell/` — App, role switcher, API client with X-Role/X-Partner, page registry (every page in docs/portal-map.md). Owner: Design System agent (shell) + Lead.
- `src/design/` — tokens are imported from `contracts/tokens.css`; `base.css` is layout only; components go in `src/design/components/`. Owner: Design System agent.
- `src/admin/` — UI-Admin agent. `src/review/` — UI-Review agent. `src/portfolio/` — UI-Partner agent (rendered inside all three shells).
- `npm run dev` with the API on :8000, or `make mock` for a Prism mock of the OpenAPI on :8001 (set `VITE_API_URL`).
