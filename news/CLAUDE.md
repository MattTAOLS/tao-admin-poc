# News agent — `news/`

Goal: a separate worker that, once a day, finds recent news about each lending company in the `company` table, screens it,
and writes `news_item` and `adverse_item` rows, with a `news_run` row per run. It never touches extraction: not
`worker/`, not the extraction queue, not uploads. Contract: `contracts/openapi.yaml` (info "Companies (wave D)", schemas
NewsItem, AdverseItem, NewsRun, Setting `company_feeds`), tables in `db/migrations/012_wave_d_companies.sql` (the API applies
migrations at start-up; this worker only reads and writes rows). Plan: `docs/phase2/tao-admin-poc_Architecture_v1.md`,
wave D and decision D1 (free sources first; a paid supplier can replace them later behind this worker). Design:
`docs/phase2/designs/company-profile.html` notes 10 and 11.

Deliver:
1. `main.py`: loop. Each minute read `system_setting` key `company_feeds` (absent = defaults: enabled false, run_at "06:00",
   time_zone "America/Toronto", sources ["google_news", "gdelt"]). While enabled, start one `schedule` run per local day at
   or after run_at (skip if a run for that local day exists). Also block-pop the Redis list `NEWS_QUEUE` (default "news")
   for manual runs: the API inserts a `news_run` row (trigger manual, status queued) and pushes its id. Mark running,
   then ok / partial (some company or source failed, errors listed) / failed. One run at a time.
2. `sources/google_news.py`: Google News RSS search, `https://news.google.com/rss/search?q=<"name">&hl=en-CA&gl=CA&ceid=CA:en`,
   one query per company name and alias, quoted. `sources/gdelt.py`: GDELT DOC 2.0 API
   (`https://api.gdeltproject.org/api/v2/doc/doc?query=<"name">&mode=artlist&format=json&maxrecords=50&timespan=7d`).
   Standard library HTTP (urllib) with a timeout and a plain User-Agent naming the app ("tao-admin-poc news worker"); no
   personal data in requests. Rate-limit politely (GDELT asks for at most one request every 5 seconds).
   `sources/fixture.py`: reads `NEWS_FIXTURE` (a JSON file path) for tests and the e2e demo; source "fixture".
   Source is chosen per run from company_feeds.sources, or only fixture when `NEWS_SOURCE=fixture` is set.
3. Matching: keep an item only if the company name or an alias appears in its title or description as a whole phrase,
   case-insensitive (a bare short alias like "TLFC" must match as a word). Dedupe on (company_slug, url).
4. `screen.py`, deterministic keyword screening, no model calls: sentiment positive / neutral / negative from small word
   lists; adverse categories litigation, regulatory, fraud, insolvency, sanctions from keyword lists (e.g. lawsuit, sued,
   claim filed; regulator, securities commission, fined, enforcement; fraud, misrepresentation; insolvency, bankruptcy,
   receivership, CCAA, BIA proposal; sanctions, sanctioned). A hit writes an `adverse_item` (state open) linked to the
   news item, one per category. Keep the lists in one data file with tests for each category and for false friends.
5. Tests (`news/tests/`, pytest, no network): HTTP is mocked or fixtures are used; matching, screening, run lifecycle,
   schedule-once-per-day across time zones, manual queue, partial failure, dedupe. Run against sqlite or a throwaway
   Postgres as the API tests do.
Done when: tests pass; `docker compose up` starts the `news` container, idle while company_feeds.enabled is false; with it
true and NEWS_SOURCE=fixture a run writes items the API serves on `/companies/{slug}/news` and `/adverse`.

Out of scope: sanctions-list checks (the sanctions category is a keyword hit, said so in the UI), paid suppliers, email,
industry averages. Notifications are made by the API's sweep, not here.
