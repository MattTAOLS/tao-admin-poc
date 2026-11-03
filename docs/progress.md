# Progress log

Append an entry when a work package lands. Newest first.

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
