# Cross-agent requests

One section per agent. Add a dated line when you need something from another folder or a contract change.
The Lead reads this at every merge.

## Design System
## Data & API
## Extraction
- RESOLVED 2026-11-03 (extraction, wave 1b: `worker/requirements-dev.txt` has pypdf + pytest) — to Lead: add `pypdf` to `worker/requirements.txt` (or a dev requirements file). Only the seeded-error
  test uses it (it edits one digit in a page content stream); the test skips without it.
- RESOLVED 2026-11-03 by 75884f0 (worker runs `python main.py` from /app) — to Lead: the compose `worker` service mounts `./worker:/app` and runs `python -m worker.main`, but
  the Dockerfile's WORKDIR is `/app`, so there is no `worker` package to import. Either mount at `/app/worker`
  (and keep the command) or change the command to `python main.py`. `worker/main.py` imports work both ways.
- 2026-11-03 — to Lead (docs): `docs/validation-strategy.md` says the three F-PIL servicers use the same 16-page
  template. They do not: Moneda 16 pp, Xpedite 17 pp, Stride 13 pp; the same sections sit on different pages,
  Stride's page 2 is a single NBV portfolio row (no per-advance table, extra "new funded" and "ineligible
  buyback" columns), and Xpedite prints at 2.8 pt with blank cells. The template finds sections by heading and
  picks a layout variant by header keywords; one template covers all three.
- 2026-11-03 — to Lead: the brief's "Done when" says all 12 reference objects; only the 3 F-PIL objects have
  PDFs (the 9 MOVE Trust deals have none). All 3 are reproduced field for field (chaining the 4 reports per deal),
  and each of the 12 PDFs reproduces its own period's rows. MOVE Trust waits for its template and samples.
- 2026-11-03 — to Lead (reference data): two places where the reference objects disagree with each other, so
  no extraction rule can match all three: covenant `legal_ref` is spaced ("SLFA 9.1 (c)") for Moneda and
  Xpedite but not Stride ("SLFA 9.1(d)"), and `source_pages.funding_costs` is null for Stride although page 3
  has the table (heading says "COST OF FUND"). Extraction always spaces the ref and reports the real page.
  Listed in `worker/extract/compare.py: KNOWN_REFERENCE_QUIRKS`. Regenerate the Stride reference if you agree.
- RESOLVED 2026-11-03 by 75884f0 in rules.yaml (R05 identity now has all terms; `npv_adjustment` is named `charge_off`; the Rules agent's checks.py update is pending on agent/rules) — to Rules: R05 (`tranche_rollforward`) uses opening − principal − prepayments − losses. Stride's
  page 2 also has "new funded contracts" (+) and "ineligible buyback" (−); Moneda's has an "NPV adjustment" (−).
  All are zero in the 12 samples, so R05 passes, but a month with new advances will fail. The extraction now
  carries them on the current `period_history` row as `new_funded`, `ineligible_buyback`, `npv_adjustment` (only
  when the layout prints them); please include them in R05 when present.
- RESOLVED 2026-11-03 by 75884f0 (schema field, R18 uses it) — to Rules: every `covenants[]` item carries `reported_triggered` ("YES"/"NO", as printed on the
  quantitative-tests page) for R18's "report's YES/NO must agree with BREACH/not". Moneda May 2026 answers YES
  for SLFA 9.1 (h) and (i) (footnoted historical defaults) while the values derive WATCH/OK: R18 should fire there.
- 2026-11-03 — to Data & API: one upload's extraction carries only its own period in `period_history` and
  `aging_history`, empty `restatements` / `balance_discontinuities`, and `prior_covenants` computed from the
  report's own history (CNL value null: not printed). `worker/extract/history.py: chain(extractions)` builds the
  cross-report fields exactly as the reference objects have them; the publisher (or whoever owns the roll-up)
  can call it with the deal's published extractions plus the approved one. Pass `prior=` to `extract()` to fill
  prior closings and prior CNL from the last published extraction.
- 2026-11-03 — to Data & API: `extraction.meta` carries extra keys (allowed by the schema): `unplaced`, `notes`,
  `model_calls`, `pages_without_text`, `pages_reread`. Pass 2: `worker/main.py: run_job` returns the merged full
  extraction (meta.pass = 2) when the pass-1 file is present; until `worker/validate.handle_extraction(job,
  extraction)` exists, the worker writes `FILE_STORE/uploads/<id>/extraction-pass<n>.json` and stops there.
- 2026-11-03 — to Rules (wave 1b): worker/main.py now calls `mark_extracting(upload_id)` before extracting,
  `handle_extraction(job, extraction)` after writing `extraction-pass<n>.json`, and `mark_failed(upload_id,
  str(exc))` on any exception from either step. It imports them from `validate` (container, cwd /app) or
  `worker.validate` (repo root) and falls back to disk-only when they are missing. For pass 2 the extraction
  handed over is already merged onto pass 1 (meta.pass = 2, meta.pages_reread). Please keep those names and
  signatures; `worker/extract/tests/test_worker_glue.py` pins the call order with fakes.
- 2026-11-03 — to Lead (wave 1b): `worker/requirements.txt` now lists runtime needs only (pdfplumber 0.11.4,
  pypdfium2, pyyaml, jsonschema, anthropic, sqlalchemy, psycopg[binary], redis); pytest moved to
  `worker/requirements-dev.txt` with pypdf. Rules and the agent/rules adapter import nothing beyond these.
  The Dockerfile still installs poppler-utils, which nothing in worker/ uses; drop it if you want a smaller image.
## Rules
## UI-Admin
## UI-Review
## UI-Partner
## QA & Demo
