# Progress log

Append an entry when a work package lands. Newest first.

- 2026-11-03 — Extraction: wave 1b seams (merged lead/wave1-seams). The page-2 NPV adjustment is emitted as
  `period_history[].charge_off`; `new_funded` and `ineligible_buyback` stay, positive amounts, only where the
  layout prints them (Moneda: charge_off; Stride: new_funded, ineligible_buyback; Xpedite: none). All 12
  extractions validate and close the new R05 identity within $1 (tested directly until Rules' checks.py lands).
  `worker/main.py handle()` calls validate's mark_extracting / handle_extraction / mark_failed, keeps writing
  `extraction-pass<n>.json`, and falls back to disk-only without the adapter; tests cover success, pass 2,
  extraction failure and hand-off failure with fakes, plus a `python main.py`-style import from worker/.
  Requirements: `worker/requirements.txt` (runtime) and `worker/requirements-dev.txt` (pytest, pypdf).
  Run: `pip install -r worker/requirements-dev.txt && python -m pytest -q worker/extract/tests`.
- 2026-11-03 — Extraction: wave 1 deliverables 1–6 on `agent/extraction`. `extract(pdf, template_id, pages=None)`
  in `worker/extract/` reads the text layer with pdfplumber (repairs Excel's phantom spaces inside numbers,
  detects negative signs by geometry, aligns blank cells by column edges), parses sections by heading through
  `templates/fpil-2.0-settrep-v1.yaml`, derives the dashboard fields (current period rows, ratio_history,
  cnl_by_period with limits, covenants with status/trend/utilization, summary, financial_ratios) and records a
  source (page, bbox, raw text) for every leaf. Result: the 3 F-PIL reference objects reproduced field for field
  from their PDFs (`history.chain` over the 4 reports per deal; tolerance $0.01 / 0.0001), every one of the 12
  PDFs matches its period's rows, all pass phase-1 rules with no block finding, and a copy of Moneda 202608 with
  one digit changed on page 2 fails R05 by exactly −100.00. Claude fallback (`ANTHROPIC_MODEL`) is asked only
  for unplaced cells, JSON-validated, every call logged; the 12 samples need none. Pass 2 re-reads named pages
  and returns a patch (`merge_patch` applies it). `worker/main.py` runs jobs and hands off to `worker/validate`.
  Run: `python -m pytest -q worker/extract/tests` (≈2 min; sample tests skip without `data/samples/`);
  `python -m worker.extract.compare <pdf> <reference.dashboard.json>`. Stubbed: OCR fallback (pages without
  text are listed in `meta.pages_without_text`), MOVE Trust template, the validate hand-off. Needs: see
  docs/requests.md › Extraction (pypdf, compose worker path, R05 extra terms, reference quirks).
- 2026-11-03 — Lead: wave-1 seam decisions (branch lead/wave1-seams). Roll-forward terms: `charge_off` is the one
  name for the page-2 NPV adjustment (column i), already in the reference data; `new_funded` (+) and
  `ineligible_buyback` (−) are new optional period_history fields, all positive amounts. R05 is now opening +
  new_funded − principal − prepayments − losses − charge_off − ineligible_buyback. `covenants[].reported_triggered`
  (YES/NO) is in the schema and R18 uses it. rules.yaml also takes Rules' R03 range, R09 fn and R18 floor band.
  Compose: worker runs `python main.py` from /app (imports `extract`, `validate`, `rules`); api mounts
  docs/dashboard-json for the demo seed. Worker hand-off: worker/validate owns every database write
  (`mark_extracting`, `handle_extraction`, `mark_failed`); worker/main.py calls them.
- 2026-11-03 — Lead: day-0 scaffold. Contracts (OpenAPI 19 routes, extraction + finding schemas, 22 rules as
  data, tokens, motion), compose with five services, API role gates with tests, rules engine with R01/R05/R07 and
  reference-data tests, web shell with role switcher and every portal-map page routed, seed data, agent briefs.
  Findings from real data: F-PIL and six MOVE Trust deals close their roll-forward to the cent; three MOVE Trust
  deals do not (see rules tests); two aging conventions exist.
