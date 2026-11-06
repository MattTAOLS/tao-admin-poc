# News worker (`news/`)

A separate worker that finds recent news about each company in the `company` table, screens it with keyword lists, and
writes `news_item` and `adverse_item` rows plus one `news_run` row per run. It never touches extraction, the extraction
queue or uploads. Brief: `news/CLAUDE.md`. Contract: `contracts/openapi.yaml` (NewsItem, AdverseItem, NewsRun, Setting
`company_feeds`). Tables: `db/migrations/012_wave_d_companies.sql`.

## How it runs

`python main.py` (the compose service `news`). Every minute, and whenever the queue wakes it, the worker:

1. reads `system_setting` key `company_feeds` (absent or partial: defaults `enabled` false, `run_at` "06:00",
   `time_zone` "America/Toronto", `sources` ["google_news", "gdelt"]);
2. runs every `news_run` row with status `queued`, oldest first (the Run now requests);
3. starts the day's scheduled run if `enabled` is true, local time in `time_zone` is at or after `run_at`, and no
   `schedule` run exists for that local date. It inserts that row itself (trigger `schedule`).

Run now: the API inserts a `news_run` row (trigger `manual`, status `queued`) and LPUSHes the run id (a plain string) to
the Redis list `NEWS_QUEUE` (default `news`). The worker BRPOPs the list, so the message is only a wake-up; the queued row
is what runs, so a lost message still runs within a minute. Runs go one at a time. A queued run that meets
`enabled: false` is finished as `failed` with the error "company_feeds is off; nothing was fetched", so it never blocks
Run now. At start-up a run left `running` by a stopped worker is marked `failed`.

Status: `ok` when there are no errors; `partial` when some company or source failed and something succeeded; `failed`
when nothing succeeded. `errors` lists `{company_slug, source, message}` per failed company and source (`company_slug`
null for run-level errors; `source` `worker` for the worker's own problems).

Nothing is fetched while `company_feeds.enabled` is false.

## Sources

| Source | Request | Notes |
| --- | --- | --- |
| `google_news` | `https://news.google.com/rss/search?q="<term>"&hl=en-CA&gl=CA&ceid=CA:en`, one per name and alias | at least 2 s between requests; items older than the look-back dropped |
| `gdelt` | `https://api.gdeltproject.org/api/v2/doc/doc?query=("<name>" OR "<alias>")&mode=artlist&format=json&maxrecords=50&timespan=<look-back>d`, one per company | at least 10 s between requests; a 429 waits 20 s and retries once; after 3 companies in a row end in 429, GDELT is skipped for the rest of the run with one error "gdelt rate-limited; skipped remaining companies" |
| `fixture` | the JSON file in `NEWS_FIXTURE` | only when `NEWS_SOURCE=fixture`; replaces the configured sources |

Look-back (`sources/net.py`): a company with no `news_item` rows yet keeps items up to `FIRST_LOOKBACK_DAYS` (90) old;
once it has rows, `LOOKBACK_DAYS` (7). Fixture items are never dropped for age.

HTTP is `urllib` with a 20 s timeout, the User-Agent `tao-admin-poc news worker`, and no cookies, email address or other
personal data.

## Matching and screening

An item belongs to a company when the name or an alias appears in its title or description as a whole phrase,
case-insensitive, with no letter or digit directly before or after it ("TLFC" matches "(TLFC) reports" but not "TLFCX").
Items are deduped on (company_slug, url); the same article for two companies is two rows.

`screen.py` with the word lists in `screen_terms.json`: five adverse categories (litigation, regulatory, fraud,
insolvency, sanctions) and positive / negative sentiment words. A hit in a category writes one `adverse_item` (state
`open`) per category, linked to the news item, and makes the sentiment `negative`. Otherwise sentiment is positive or
negative by word count, neutral on a tie. No model calls, no paid services. Sanctions is a keyword hit, not a list check.

## Fixture format (`NEWS_SOURCE=fixture`)

```json
{
  "fail_companies": ["tlfc"],
  "items": [
    {"title": "Test item: ...", "url": "https://example.com/...", "publisher": "Test Wire",
     "published_at": "-2d", "description": "Fictional test data, not a real report."}
  ]
}
```

- `items` (required): every item is offered to every company; the normal matcher decides which company it belongs to.
  `title` and `url` are required; `publisher` and `description` are optional.
- `published_at`: an ISO date-time (`2026-11-02T14:00:00Z`), a time relative to the run (`-2d`, `-3h`, `-30m`), or
  absent (null). Use relative times so "News this week" stays populated.
- `fail_companies` (optional): company slugs for which the source raises an error, to drive a `partial` run.
- Titles start with "Test item:" and URLs point at example.com. Fixture text must never state real facts about the real
  companies.

`fixtures/example.json` covers the five categories (VCC IV LP's item hits two), positive, neutral and negative
sentiment, an alias found only in the description (TPine Leasing), and two false friends that must not match ("TLFCX
Holdings", "Essex Lease Financing Ltd"). Against the seed companies one run writes 10 news items and 7 adverse items.

To use it in compose, add to `.env` (the service reads `env_file: .env`; `./news` is mounted at `/app`):

```
NEWS_SOURCE=fixture
NEWS_FIXTURE=/app/fixtures/example.json
```

then set `company_feeds` to `{"enabled": true, ...}` through `PUT /settings/company_feeds` and press Run now
(`POST /news/runs`), or wait for the scheduled time.

## Tests

`pip install -r news/requirements-dev.txt`, then `python -m pytest news/tests` from the repo root (or `tests` from
`news/`). SQLite per test; any real network call fails the test.
