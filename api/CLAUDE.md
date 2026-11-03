# Data & API agent — `api/`, `db/migrations/`

Goal: make every route in `contracts/openapi.yaml` real, backed by PostgreSQL, with the role gates already in
`app/auth.py` and `app/main.py` kept exactly as they are (tests in `tests/test_roles.py` must stay green).

Deliver (wave 1, days 1–5):
1. SQLAlchemy models for the tables in `db/migrations/001_init.sql` (you may add migrations, numbered).
2. `make seed` loads `seed/*.json` idempotently.
3. `POST /uploads`: store the PDF under `FILE_STORE/uploads/<id>/source.pdf`, count pages (pypdfium2), create the
   row as `received`, push `{"upload_id", "pass": 1}` to Redis list `extract:jobs`, return the Upload.
   Pre-check R12 (409 if a publication exists for deal + period).
4. Extraction and finding read routes; override (re-runs `rules.run()` over the latest extraction with the
   resolution applied, writes a review_action); reextract (pushes a pass-2 job with pages); approve (refuses with
   409 while any block finding is open; writes a publication row with the approved `deal`; triggers regeneration);
   reject; page image (render page n with pypdfium2 at 110 dpi, cache under the upload folder).
5. Master data routes; `GET /master/covenants?as_of=` returns the definitions effective at that date.
6. Published views: portfolio → list of programs with their latest period aggregate; program → the program
   aggregate (same shape as `docs/dashboard-json/program-*.dashboard.json`: rebuild it from publication rows using
   `worker/publish` or a shared module — coordinate with the Extraction agent on who owns the roll-up); deal →
   the published deal object plus `published_at`, `published_by`, `upload_id`. Partner filter in ONE dependency.
7. Audit route reading review_action.
Done when: `pytest` passes with a test per route including the negative tenancy tests, `make check` passes,
and the OpenAPI the app serves at `/api/v1/openapi.json` matches `contracts/openapi.yaml` route-for-route
(add a test that diffs the path sets).

Do not: change route shapes (propose a contract change to the Lead instead), put rule logic in the API (import
`rules`), read `.env` values you don't need, bypass the partner filter for convenience.

## Rules every agent follows

- Work only inside your folder(s) listed above. If you need something elsewhere, write it down in `docs/requests.md` under your agent name and tell the Lead; do not edit another agent's folder or anything in `contracts/`.
- Build against the contracts, not against another agent's code: `contracts/openapi.yaml`, `contracts/extraction.schema.json`, `contracts/finding.schema.json`, `contracts/rules.yaml`, `contracts/tokens.css`, `contracts/motion.md`. UI agents run `make mock` (Prism on :8001) until the real API is merged.
- Branch: `agent/<your-name>` off `main`. Commit small and often with messages that start with your agent name, e.g. `rules: R11 opening equals prior closing`. Never commit to `main`; never commit `.env` or anything under `data/`.
- Before every commit: your own tests pass, and `make check` passes from the repo root (it validates the contracts and the reference data). If `make check` fails because of your change, fix your change.
- Real data lives in `docs/dashboard-json/` (12 deals, 2 programs) and the SetRep PDFs the Lead places under `data/samples/` (git-ignored). The field inventory is `docs/dashboard-json/SCHEMA.md`. Never invent numbers; fixtures are copies of real objects with one deliberate change.
- Reads before writes: `docs/portal-map.md` (pages, roles, routes), `docs/validation-strategy.md` (rules, workflow), the build plan sections quoted in your brief.
- Design: tokens only, never raw colours; dense tables where the data is (13 px Inter, tabular numerals, right-aligned numbers, sticky header); status is always a dot plus a word. Motion per `contracts/motion.md`.
- When done with a work package, append a short entry to `docs/progress.md`: what is built, how to run it, what is stubbed, what you need from others.
