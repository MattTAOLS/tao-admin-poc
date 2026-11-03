# QA & Demo agent — `tests/e2e/`, `docs/demo.md`, `scripts/reset_demo.py`

Goal: the demo script in the build plan runs green, end to end, from a fresh `docker compose up`, as Playwright
tests and as a written walkthrough a person can follow.

Deliver (wave 2, days 7–10):
1. `scripts/reset_demo.py`: drop and recreate the database, run migrations and seed, clear the file store, copy
   the sample PDFs into place, and create the seeded-error PDF (one digit changed on page 2 of a copy of the
   Moneda 2026-08 report; keep the tool that makes it in `scripts/`).
2. Playwright tests, one per demo step (build plan "Demo script and acceptance", steps 1–7), each switching
   role through the sidebar control, asserting on visible text and on API state via the role-header client.
3. Negative tests: an investor role requesting a manager program by URL and by API gets no access; an analyst
   cannot approve; publish is refused while a block finding is open.
4. `docs/demo.md`: the walkthrough with screenshots captured by the tests, in the order of the journeys.
5. Acceptance table from the build plan, filled in with measured values (extraction time per report,
   Lighthouse scores, numbers match).
Done when: `npm run test:e2e` is green on a clean machine following only `README.md`, and `docs/demo.md` is
current with the screenshots.

Do not: fix application bugs you find in other agents' folders; file them in `docs/requests.md` with the
failing test name and hand them to the Lead.

## Rules every agent follows

- Work only inside your folder(s) listed above. If you need something elsewhere, write it down in `docs/requests.md` under your agent name and tell the Lead; do not edit another agent's folder or anything in `contracts/`.
- Build against the contracts, not against another agent's code: `contracts/openapi.yaml`, `contracts/extraction.schema.json`, `contracts/finding.schema.json`, `contracts/rules.yaml`, `contracts/tokens.css`, `contracts/motion.md`. UI agents run `make mock` (Prism on :8001) until the real API is merged.
- Branch: `agent/<your-name>` off `main`. Commit small and often with messages that start with your agent name, e.g. `rules: R11 opening equals prior closing`. Never commit to `main`; never commit `.env` or anything under `data/`.
- Before every commit: your own tests pass, and `make check` passes from the repo root (it validates the contracts and the reference data). If `make check` fails because of your change, fix your change.
- Real data lives in `docs/dashboard-json/` (12 deals, 2 programs) and the SetRep PDFs the Lead places under `data/samples/` (git-ignored). The field inventory is `docs/dashboard-json/SCHEMA.md`. Never invent numbers; fixtures are copies of real objects with one deliberate change.
- Reads before writes: `docs/portal-map.md` (pages, roles, routes), `docs/validation-strategy.md` (rules, workflow), the build plan sections quoted in your brief.
- Design: tokens only, never raw colours; dense tables where the data is (13 px Inter, tabular numerals, right-aligned numbers, sticky header); status is always a dot plus a word. Motion per `contracts/motion.md`.
- When done with a work package, append a short entry to `docs/progress.md`: what is built, how to run it, what is stubbed, what you need from others.
