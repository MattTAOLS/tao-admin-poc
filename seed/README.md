# Seed data

Loaded by `make seed` (api/app/seed.py). Partners, programs and deals come from the portal map and the shared
dashboards. Covenant definitions are for the three F-PIL 2.0 deals only, copied from page 14 of the Moneda
2026-08 SetRep and marked UNVERIFIED in `source`; replace them from the executed SLFA when available. MOVE Trust
deals have no covenant definitions yet (no MOVE Trust SetRep seen). Program limits: MOVE Trust from the shared
executive summary ($1,916,709,163), F-PIL 2.0 from the same ($150,000,000); the Moneda deal object shows a
per-deal program_limit of $50,000,000, which is the deal's facility, not the program's.

## users.json (phase 2, wave C)

One or two sample users per role, so the role switcher can sign in as a real user (X-User) and notifications, comments,
mentions and profile work in the demo. Names are generic samples and emails use example.com. The seed creates them if missing
and never changes a user someone edited in the app. Subscriptions start empty; TAO Admins set them in User management.
