# Rules agent — `rules/` and `worker/validate/`

Goal: every rule in `contracts/rules.yaml` implemented in `rules/checks.py` (one function per `fn`), with a
passing and a failing fixture each, producing findings that validate against `contracts/finding.schema.json`.
Phase-1 rules (R01–R09, R11–R13, R17, R18) by day 5; R10, R14, R15, R19 in wave 2; R16, R20–R22 are listed
for completeness and stay unimplemented in the POC unless time allows.

What you have: `rules/engine.py` (loader, Context, finding builder, `run()`), three rules already implemented
(R01, R05, R07) as the pattern, tests that run every reference deal through the implemented rules, and
`docs/validation-strategy.md` for the intent of each rule.

Deliver:
1. `checks.py` functions. Messages are sentences a reviewer can act on, with the numbers in them. `context`
   carries the terms of the identity so the FindingCard can show the arithmetic.
2. `worker/validate/`: adapter that builds `Context` (prior published deal, master covenant definitions as of the
   period, published periods for R12, upload metadata for R13) by reading the database, runs `run()`, and
   returns findings for the API/worker to persist. Keep `rules/` itself free of DB and HTTP.
3. R18 status derivation must reproduce every `covenants[].status` and `worst_status` in the 12 reference deals
   (ceiling: value > threshold → BREACH; within `watch_buffer_pct` × threshold → WATCH; floor mirrored).
   R14 resolves `threshold_rule` bands against the pointer in `on`.
4. Fixtures under `tests/fixtures/`: `<rule>-pass.json` and `<rule>-fail.json` deal objects (copies of real ones
   with one change) and the expected finding.
Done when: `pytest` green, every rule has both fixtures, the 12 reference deals produce no block findings except
the documented MOVE Trust roll-forward gaps, and `run()` over one deal takes under 2 s.

Do not: change rule ids, severities or tolerances in `rules.yaml` without the Lead (propose it in
`docs/requests.md`); reach into the database from `rules/`.

## Rules every agent follows

- Work only inside your folder(s) listed above. If you need something elsewhere, write it down in `docs/requests.md` under your agent name and tell the Lead; do not edit another agent's folder or anything in `contracts/`.
- Build against the contracts, not against another agent's code: `contracts/openapi.yaml`, `contracts/extraction.schema.json`, `contracts/finding.schema.json`, `contracts/rules.yaml`, `contracts/tokens.css`, `contracts/motion.md`. UI agents run `make mock` (Prism on :8001) until the real API is merged.
- Branch: `agent/<your-name>` off `main`. Commit small and often with messages that start with your agent name, e.g. `rules: R11 opening equals prior closing`. Never commit to `main`; never commit `.env` or anything under `data/`.
- Before every commit: your own tests pass, and `make check` passes from the repo root (it validates the contracts and the reference data). If `make check` fails because of your change, fix your change.
- Real data lives in `docs/dashboard-json/` (12 deals, 2 programs) and the SetRep PDFs the Lead places under `data/samples/` (git-ignored). The field inventory is `docs/dashboard-json/SCHEMA.md`. Never invent numbers; fixtures are copies of real objects with one deliberate change.
- Reads before writes: `docs/portal-map.md` (pages, roles, routes), `docs/validation-strategy.md` (rules, workflow), the build plan sections quoted in your brief.
- Design: tokens only, never raw colours; dense tables where the data is (13 px Inter, tabular numerals, right-aligned numbers, sticky header); status is always a dot plus a word. Motion per `contracts/motion.md`.
- When done with a work package, append a short entry to `docs/progress.md`: what is built, how to run it, what is stubbed, what you need from others.
