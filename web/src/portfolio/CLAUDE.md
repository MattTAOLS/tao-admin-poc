# UI-Partner agent — `web/src/portfolio/`

Goal: the portfolio pages, built once and rendered in all three shells: Portfolio Executive Summary, Program
Executive Summary, Program Dashboard (Portfolio Metrics + Covenant Status & Review), Deal page (Deal Metrics +
covenant detail). Data comes only from `/published/*`. The reference for what to show and the numbers to match
is the shared dashboard set: `docs/dashboard-json/program-*.dashboard.json` and `<deal>.dashboard.json`, and the
rendering logic in `docs/dashboard-renderer.reference.js` (read it for the metric definitions, e.g. program
utilization weighted by facility size, covenant totals, CNL tables, the watch threshold control).

Deliver (wave 1, days 2–6):
1. Portfolio Executive Summary: one card per program the caller may see (KpiTiles: tranche balance with change,
   utilization, covenant counts, deals flagged), a flagged-deals list, "Go to deal" picker.
2. Program Executive Summary: the program's tiles plus a deal card per deal with status pill (OK / WATCH /
   BREACH) and link to the deal page; prev/next program.
3. Program Dashboard: Portfolio Metrics tiles; Covenant Status & Review table (deal × covenant with status,
   value, threshold, utilization %, trend), expand row → covenant detail, Expand all / Collapse all, watch
   threshold control (client-side display filter only), Print / Save as PDF via a print stylesheet.
4. Deal page: Deal Metrics (balances, contracts, aging buckets, losses, CNL by vintage, borrower ratios),
   covenant table with legal ref and description, ratio history as a small chart (one series, 13 months), prev /
   next deal within the program, period picker.
5. In the TAO Admin shell only: a strip showing upload status and a link to the review page for that period.
Done when: for every published deal the numbers on screen equal the reference `dashboard.json` within
$1 / 0.01 pp; switching to a partner role that does not own the program shows "You don't have access";
print of the Program Dashboard fits on A4/Letter.

Do not: read intake routes; invent metrics the published object does not carry; restyle components.

## Rules every agent follows

- Work only inside your folder(s) listed above. If you need something elsewhere, write it down in `docs/requests.md` under your agent name and tell the Lead; do not edit another agent's folder or anything in `contracts/`.
- Build against the contracts, not against another agent's code: `contracts/openapi.yaml`, `contracts/extraction.schema.json`, `contracts/finding.schema.json`, `contracts/rules.yaml`, `contracts/tokens.css`, `contracts/motion.md`. UI agents run `make mock` (Prism on :8001) until the real API is merged.
- Branch: `agent/<your-name>` off `main`. Commit small and often with messages that start with your agent name, e.g. `rules: R11 opening equals prior closing`. Never commit to `main`; never commit `.env` or anything under `data/`.
- Before every commit: your own tests pass, and `make check` passes from the repo root (it validates the contracts and the reference data). If `make check` fails because of your change, fix your change.
- Real data lives in `docs/dashboard-json/` (12 deals, 2 programs) and the SetRep PDFs the Lead places under `data/samples/` (git-ignored). The field inventory is `docs/dashboard-json/SCHEMA.md`. Never invent numbers; fixtures are copies of real objects with one deliberate change.
- Reads before writes: `docs/portal-map.md` (pages, roles, routes), `docs/validation-strategy.md` (rules, workflow), the build plan sections quoted in your brief.
- Design: tokens only, never raw colours; dense tables where the data is (13 px Inter, tabular numerals, right-aligned numbers, sticky header); status is always a dot plus a word. Motion per `contracts/motion.md`.
- When done with a work package, append a short entry to `docs/progress.md`: what is built, how to run it, what is stubbed, what you need from others.
