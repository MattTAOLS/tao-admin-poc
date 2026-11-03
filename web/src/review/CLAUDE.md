# UI-Review agent — `web/src/review/`

Goal: Approval queue, Review report (with the Reject and Publish pop-ups), Reports library with the Regenerate
dashboard pop-up. This is the screen the POC is judged on: a reviewer must see in one glance what is wrong,
where on the PDF, and what the two candidate values are.

Deliver (wave 1, days 2–6):
1. Approval queue: table of uploads in `needs_review` (and `approved` awaiting publish if that state is used),
   sorted oldest first, with finding counts by severity as pills and the deal / period / uploader.
2. Review report, three regions: (a) header with status, deal, period, both dates, extraction pass and
   confidence; (b) findings list grouped block → review → note, each a FindingCard showing rule id and title,
   the message, ours vs report with the difference and tolerance, the arithmetic from `context`, and the page
   crop from `/uploads/{id}/pages/{n}.png` (zoomable); actions per card for `tao_admin`: use ours / use report /
   accept as restatement / acknowledge, each requiring a reason, calling the override route and refreshing;
   (c) an extracted-values panel: the deal object rendered as sections mirroring the SetRep pages (balances,
   contracts, aging, losses, covenants) with a source-page link on every value.
   Footer: Re-extract pages… (ReextractRequest), Reject (dialog with reason), Publish to partner (disabled
   while block findings are open, with the reason shown).
3. Reports library: published uploads by deal and period with a link to the partner view and a Regenerate
   dashboard pop-up calling `/published/regenerate`.
Done when: the seeded-error walkthrough (demo steps 4–5 in the build plan) runs against the real API: a block
finding on R05 is shown with its page crop, overridden with a reason, re-run clears it, publish succeeds, and
the audit log shows the override. Analysts can open the page but see no action buttons.

Do not: compute or re-check anything client-side that the rule engine already did; show a finding without its
page reference; let a partner role reach these routes (the shell blocks it, the API blocks it, your pages
should not fetch intake routes for partner roles either).

## Rules every agent follows

- Work only inside your folder(s) listed above. If you need something elsewhere, write it down in `docs/requests.md` under your agent name and tell the Lead; do not edit another agent's folder or anything in `contracts/`.
- Build against the contracts, not against another agent's code: `contracts/openapi.yaml`, `contracts/extraction.schema.json`, `contracts/finding.schema.json`, `contracts/rules.yaml`, `contracts/tokens.css`, `contracts/motion.md`. UI agents run `make mock` (Prism on :8001) until the real API is merged.
- Branch: `agent/<your-name>` off `main`. Commit small and often with messages that start with your agent name, e.g. `rules: R11 opening equals prior closing`. Never commit to `main`; never commit `.env` or anything under `data/`.
- Before every commit: your own tests pass, and `make check` passes from the repo root (it validates the contracts and the reference data). If `make check` fails because of your change, fix your change.
- Real data lives in `docs/dashboard-json/` (12 deals, 2 programs) and the SetRep PDFs the Lead places under `data/samples/` (git-ignored). The field inventory is `docs/dashboard-json/SCHEMA.md`. Never invent numbers; fixtures are copies of real objects with one deliberate change.
- Reads before writes: `docs/portal-map.md` (pages, roles, routes), `docs/validation-strategy.md` (rules, workflow), the build plan sections quoted in your brief.
- Design: tokens only, never raw colours; dense tables where the data is (13 px Inter, tabular numerals, right-aligned numbers, sticky header); status is always a dot plus a word. Motion per `contracts/motion.md`.
- When done with a work package, append a short entry to `docs/progress.md`: what is built, how to run it, what is stubbed, what you need from others.
