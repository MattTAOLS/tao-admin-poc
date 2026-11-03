# Extraction agent — `worker/extract/` (and `worker/main.py` glue)

Goal: `extract(pdf_path, template_id, pages=None) -> dict` that validates against
`contracts/extraction.schema.json` and reproduces the real `docs/dashboard-json/<deal>.dashboard.json` objects
from the sample SetReps, with provenance for every value.

What you have: 12 real target objects; the SetRep PDFs (Lead places them under `data/samples/`, three F-PIL 2.0
deals × May–Aug 2026; Excel-generated, 16 pages, clean text layer — `pdfplumber` returns aligned tables);
`docs/dashboard-json/SCHEMA.md`; `docs/validation-strategy.md` section "What the sample SetReps add" (page map,
printed formulas, period naming, conditional thresholds, `#N/A` rows, free-text notes).

Deliver (wave 1, days 1–6; pass 2 and OCR fallback in wave 2):
1. `templates/fpil-2.0-settrep-v1.yaml`: a mapping from report sections (by page and heading) to deal-object
   paths, with parsing hints (number formats, "-" = 0, "#N/A" = skip, percent vs fraction, date formats).
   Keep the mapping as data so a second template (MOVE Trust, not yet seen) is a new file, not new code.
2. `text.py`: page text + tables via pdfplumber; detect pages with no text (route to OCR fallback later).
3. `mapper.py`: deterministic parsing first; Claude (model from `ANTHROPIC_MODEL`) only for cells the parser
   cannot place, with the page text and the target field list in the prompt, asking for cell values + page +
   raw text, JSON-only output validated against the schema. Log every model call (prompt size, fields asked).
4. `provenance`: for each leaf written, a `sources` entry with page, bbox if pdfplumber gives it, raw_text.
5. Derived fields the dashboards expect (period_history row for the current period, ratio_history, aging_history,
   cnl_by_period, covenants with status) computed from the parsed tables, matching the real objects.
6. Pass 2: `extract(..., pages=[...])` re-reads only those pages and returns a patch; `meta.pass = 2`.
Done when: all 12 reference objects are reproduced from their PDFs for every field the rules read (compare with
a tolerance of $0.01 / 0.0001), `make check` passes, and a seeded-error PDF (change one digit on page 2 of a
copy) produces an object that fails R05 by exactly that amount.

Known gap to design for: three MOVE Trust reference deals (Finloc, TLFC LP, Meridian) do not close their
tranche roll-forward on the fields dashboard.json carries (`rules/tests/test_engine.py: KNOWN_ROLLFORWARD_GAPS`).
The MOVE Trust template has roll-forward columns the current pipeline drops; capture them when that template arrives.

Do not: call the model for whole pages when a table parses; write anything into the database (the worker
adapter in `worker/validate/` and the API do that); hard-code deal names.

## Rules every agent follows

- Work only inside your folder(s) listed above. If you need something elsewhere, write it down in `docs/requests.md` under your agent name and tell the Lead; do not edit another agent's folder or anything in `contracts/`.
- Build against the contracts, not against another agent's code: `contracts/openapi.yaml`, `contracts/extraction.schema.json`, `contracts/finding.schema.json`, `contracts/rules.yaml`, `contracts/tokens.css`, `contracts/motion.md`. UI agents run `make mock` (Prism on :8001) until the real API is merged.
- Branch: `agent/<your-name>` off `main`. Commit small and often with messages that start with your agent name, e.g. `rules: R11 opening equals prior closing`. Never commit to `main`; never commit `.env` or anything under `data/`.
- Before every commit: your own tests pass, and `make check` passes from the repo root (it validates the contracts and the reference data). If `make check` fails because of your change, fix your change.
- Real data lives in `docs/dashboard-json/` (12 deals, 2 programs) and the SetRep PDFs the Lead places under `data/samples/` (git-ignored). The field inventory is `docs/dashboard-json/SCHEMA.md`. Never invent numbers; fixtures are copies of real objects with one deliberate change.
- Reads before writes: `docs/portal-map.md` (pages, roles, routes), `docs/validation-strategy.md` (rules, workflow), the build plan sections quoted in your brief.
- Design: tokens only, never raw colours; dense tables where the data is (13 px Inter, tabular numerals, right-aligned numbers, sticky header); status is always a dot plus a word. Motion per `contracts/motion.md`.
- When done with a work package, append a short entry to `docs/progress.md`: what is built, how to run it, what is stubbed, what you need from others.
