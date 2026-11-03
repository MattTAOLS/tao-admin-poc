# Seed data

Loaded by `make seed` (api/app/seed.py). Partners, programs and deals come from the portal map and the shared
dashboards. Covenant definitions are for the three F-PIL 2.0 deals only, copied from page 14 of the Moneda
2026-08 SetRep and marked UNVERIFIED in `source`; replace them from the executed SLFA when available. MOVE Trust
deals have no covenant definitions yet (no MOVE Trust SetRep seen). Program limits: MOVE Trust from the shared
executive summary ($1,916,709,163), F-PIL 2.0 from the same ($150,000,000); the Moneda deal object shows a
per-deal program_limit of $50,000,000, which is the deal's facility, not the program's.
