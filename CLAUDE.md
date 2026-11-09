# TAO Admin POC — root brief (read first, every agent)

What this is: a proof of concept that takes an uploaded SetRep (settlement report PDF), extracts its numbers,
validates them with deterministic rules, lets a TAO reviewer approve or reject, publishes the approved deal
object, and shows it in the Investor and Manager portals. Python/FastAPI + worker, PostgreSQL, Redis,
React/Vite, all in `docker compose`. Authentication is a role switcher (`X-Role` header), on purpose.

Plan and context: the build plan (`docs/` points to it), `docs/portal-map.md`, `docs/validation-strategy.md`,
`docs/README.md`, `docs/dashboard-json/SCHEMA.md`, `seed/README.md`.

Layout and owners:

| Folder | Owner agent | Brief |
| --- | --- | --- |
| `contracts/`, `docker-compose.yml`, `docker-compose.prod.yml`, `deploy/`, `Makefile`, `scripts/`, `db/`, `seed/` | Lead | this file |
| `web/src/design/`, `web/src/shell/` | Design System | `web/src/design/CLAUDE.md` |
| `api/` | Data & API | `api/CLAUDE.md` |
| `worker/extract/` | Extraction | `worker/extract/CLAUDE.md` |
| `rules/`, `worker/validate/` | Rules | `rules/CLAUDE.md` |
| `news/` (wave D) | News | `news/CLAUDE.md` |
| `web/src/admin/` | UI-Admin | `web/src/admin/CLAUDE.md` |
| `web/src/review/` | UI-Review | `web/src/review/CLAUDE.md` |
| `web/src/portfolio/` | UI-Partner | `web/src/portfolio/CLAUDE.md` |
| `tests/e2e/`, `docs/demo.md` | QA & Demo | `tests/e2e/CLAUDE.md` |

Upload state machine (fixed): received → extracting → needs_review → approved → published; exits: rejected,
extraction_failed. Only `tao_admin` approves, rejects, overrides, publishes. Partner roles read `/published/*` only,
filtered to their partner in one place (`api/app/main.py: partner_filter`).

Period naming (fixed): `collection_period` = the cover block = settlement month (`2026-08` for the file
"Moneda-202608 -SETTREP.pdf", settlement 7 Aug 2026). `meta.reporting_period` = the page-header "for reporting
period" month (`2026-07`). Rule R04 checks they are one month apart.

Gates: G1 contracts merged (this scaffold). G2 one real SetRep end to end on `main`. G3 demo script green from a
fresh `docker compose up`. Merge order each day: Design → API → Rules → Extraction → UIs → QA.

Run: copy `.env.example` to `.env`, then `docker compose up --build`; web on :5173, API on :8000
(`/api/v1/openapi.json`), `make check` for the contract check, `make mock` for the UI mock server. Hosting on a server: `docs/hosting.md`
(`docker-compose.prod.yml`, images in `deploy/`).

## Rules every agent follows

- Work only inside your folder(s) listed above. If you need something elsewhere, write it down in `docs/requests.md` under your agent name and tell the Lead; do not edit another agent's folder or anything in `contracts/`.
- Build against the contracts, not against another agent's code: `contracts/openapi.yaml`, `contracts/extraction.schema.json`, `contracts/finding.schema.json`, `contracts/rules.yaml`, `contracts/tokens.css`, `contracts/motion.md`. UI agents run `make mock` (Prism on :8001) until the real API is merged.
- Branch: `agent/<your-name>` off `main`. Commit small and often with messages that start with your agent name, e.g. `rules: R11 opening equals prior closing`. Never commit to `main`; never commit `.env` or anything under `data/`.
- Before every commit: your own tests pass, and `make check` passes from the repo root (it validates the contracts and the reference data). If `make check` fails because of your change, fix your change.
- Real data lives in `docs/dashboard-json/` (12 deals, 2 programs) and the SetRep PDFs the Lead places under `data/samples/` (git-ignored). The field inventory is `docs/dashboard-json/SCHEMA.md`. Never invent numbers; fixtures are copies of real objects with one deliberate change.
- Reads before writes: `docs/portal-map.md` (pages, roles, routes), `docs/validation-strategy.md` (rules, workflow), the build plan sections quoted in your brief.
- Design: tokens only, never raw colours; dense tables where the data is (13 px Inter, tabular numerals, right-aligned numbers, sticky header); status is always a dot plus a word. Motion per `contracts/motion.md`.
- When done with a work package, append a short entry to `docs/progress.md`: what is built, how to run it, what is stubbed, what you need from others.
