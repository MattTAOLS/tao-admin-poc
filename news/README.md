# News worker (`news/`)

A separate worker that finds recent news about each company in the `company` table, checks every new story (date check
and Claude check), and writes `news_item` and `adverse_item` rows plus one `news_run` row per run. It never touches
extraction, the extraction queue or uploads. Briefs: `news/CLAUDE.md` (waves D and E). Design:
`docs/phase2/tao-admin-poc-news_Architecture_v1.md`. Contract: `contracts/openapi.yaml` (NewsItem, AdverseItem, NewsRun,
NewsSource, Setting `company_feeds`). Tables: `db/migrations/012_wave_d_companies.sql` and `013_wave_e_news.sql`.

## How it runs

`python main.py` (the compose service `news`). Every minute, and whenever the queue wakes it, the worker:

1. reads `system_setting` key `company_feeds` (absent or partial: defaults `enabled` false, `run_at` "06:00",
   `time_zone` "America/Toronto", `sources` ["google_news", "gdelt"], `daily_cap` 200);
2. runs every `news_run` row with status `queued`, oldest first (Run now: trigger `manual`; Re-check stories: trigger
   `recheck`);
3. starts the day's scheduled run if `enabled` is true, local time in `time_zone` is at or after `run_at`, and no
   `schedule` run exists for that local date.

Queue messages on the Redis list `NEWS_QUEUE` (default `news`):

- a bare run id (a plain string): only a wake-up; the queued row is what runs, so a lost message still runs within a
  minute;
- `{"type": "test", "provider": "<provider>"}`: Test connection. The worker decrypts that provider's stored
  credentials, runs one small query ("equipment leasing", last 7 days, 5 results) and writes `news_source.last_test_at`,
  `last_test_ok` and `last_test_message` ("OK: N results for the test query", or the provider's error, secrets removed,
  at most 300 characters). It gives up after 30 seconds and records "No answer from the provider within 30 seconds".

A queued manual run that meets `enabled: false` is failed with "company_feeds is off; nothing was fetched". A recheck run
is allowed while the feed is off (it searches nothing). At start-up a run left `running` is marked `failed`.

Status: `ok` with no errors; `partial` when something failed and something succeeded; `failed` when nothing succeeded.
`errors` lists `{company_slug, source, message}`; `source` is `claude` when the check could not run, `worker` for the
worker's own problems.

## One run, per company

```
search   every source, every query, inside the window          calls counted per source; daily cap
pool     one candidate per canonical URL; sources merged        (tracking parameters and fragments removed)
filter   drop: already on file, an exclusion phrase, no whole-phrase name or alias match
date     Google link -> publisher URL, article page read once (10 s, 1.5 MB), date from its metadata
         -> confirmed | source_only | unknown; a confirmed date outside the window drops the story
context  when company.news_context_terms is set, one must appear in the title, snippet or page text
check    Claude -> kept | excluded (reason) | pending (could not run; retried at the start of the next run)
write    news_item; one adverse_item (open) per category, for kept adverse stories only
```

Before the search, stories left `pending` by an earlier run are checked again.

**Queries** (`queries.py`), per company and per language in `company.news_languages` (default en and fr): the name in
quotes, each alias, and the name with the adverse terms (EN: fraud, lawsuit, insolvency, bankruptcy, receivership,
regulator, sanction; FR: fraude, poursuite, faillite, insolvabilité, séquestre, "Autorité des marchés financiers",
sanction). Event Registry and NewsCatcher take both languages in one request for the name and alias queries; Google
News, Brave and GDELT ask once per language.

**Windows** (`sources/net.py: lookback`). A company with no `news_item` rows yet: 90 days, or 365 days when an enabled
paid source has `config.archive_months` >= 12. Later runs: 7 days. GDELT clamps to 90 days.

**Daily cap**: requests per source per local day (`company_feeds.daily_cap`, default 200), counted from the
`stats.calls` of today's runs plus this one. A source at its cap is not asked again this run and is listed in
`stats.capped`. Page reads and Google link resolution are not provider requests and are not counted.

**Dates** (decision E3). `published_at` is set only from the article: JSON-LD `datePublished`, `article:published_time`,
`og:published_time` / `og:article:published_time`, `itemprop=datePublished`, the first `<time datetime>` (`pages.py`), a
provider publication field (Event Registry `date`+`time`, NewsCatcher `published_date`), or a date Claude reads in the
text. Google `pubDate`, GDELT `seendate` and Brave `page_age` are `source_date` only. Google News links: old-style ids
decode offline; new-style ids need Google's unofficial batchexecute call, tried once with a 10-second timeout; on
failure the Google link is kept and the page is not read.

**Claude check** (`check.py`, decision E2). Model `NEWS_MODEL` (default `claude-haiku-5-5`) on `ANTHROPIC_API_KEY`,
effort low, structured output (JSON schema): `about_company`, `confidence`, `adverse`, `categories`, `sentiment`,
`published_on`, `reason`. Input: the company's name, aliases, industry, headquarters, its deals' program names, context
terms and exclusions; the story's title, publisher, URL, source date and up to 4,000 characters of page text (else the
snippet); the keyword categories from `screen.py` as a hint only. Kept when `about_company` and `confidence` >= 0.7.
Recorded on the row: `check_status`, `check_confidence`, `check_reason`, `check_model`, `checked_at`, `description` (the
text it read). No key, an API error after the SDK's retries, a refusal or a cut-off answer: the story is `pending`.

**Re-check** (trigger `recheck`, decision E9): every `unchecked` or `pending` story goes through the date check and the
Claude check. Excluded: `check_status` excluded; its open adverse items become dismissed with the note "Excluded by the
news check: <reason>", `state_by` null. Reviewed and dismissed items are untouched. Kept: new adverse categories are
written. Rows are never deleted. When the check cannot run, an unchecked row stays unchecked.

**Run counts.** `items_added`: stories that became visible this run (new kept stories, and pending ones the check kept).
`adverse_added`: adverse items written. `stats`: `calls` per source, `capped`, `candidates` (unique stories found after
pooling, plus stories re-checked), `kept`, `excluded`, `pending`, `date_confirmed` (stories stored or re-checked with a
confirmed date), `claude_input_tokens`, `claude_output_tokens`. Saved after every company, final at the end.

## Sources

| Source | Request | Dates |
| --- | --- | --- |
| `google_news` | `https://news.google.com/rss/search?q=<q>&hl=en-CA&gl=CA&ceid=CA:en` (French: `hl=fr-CA&gl=CA&ceid=CA:fr`); 2 s between requests | pubDate: source_date |
| `gdelt` | `https://api.gdeltproject.org/api/v2/doc/doc?query=<q> sourcelang:<english/french>&mode=artlist&format=json&maxrecords=250&timespan=<n>d`; 10 s between requests; a 429 waits 20 s and retries once; after 3 requests in a row end in 429, GDELT is skipped for the run | seendate: source_date |
| `event_registry` | `POST https://eventregistry.org/api/v1/article/getArticles`, `apiKey` in the body, phrase search in title and body, `lang` ["eng", "fra"], 100 per page; adverse queries use the `$query` language | date+time: confirmed; dateTimePub: source_date |
| `newscatcher` | `GET https://v3-api.newscatcherapi.com/api/search`, header `x-api-token`, `q` boolean phrase, `lang=en,fr`, `from_`/`to_`, 100 per page, `sort_by=date`; 1.1 s between requests (free plan: 1 per second) | published_date: confirmed; parse_date: source_date |
| `brave_news`, `brave_web` | `GET https://api.search.brave.com/res/v1/news/search` (count 50) and `/res/v1/web/search` (count 20), header `X-Subscription-Token`, `search_lang`, `country=CA`, `freshness` (`pw` or a date range), `extra_snippets=true`; config `news` and `web` (both default on, as the API shows them) | page_age: source_date |
| `dow_jones`, `lexisnexis` | slots: "Needs the client's API documentation" (listed as a run error if enabled) | |
| `fixture` | the JSON file in `NEWS_FIXTURE` | see below |

Paid sources are the enabled `news_source` rows. `secrets_enc` is decrypted with `NEWS_SECRET_KEY` (Fernet) for one
run; the secret field is `api_key` for Event Registry, NewsCatcher and Brave. A row whose credentials cannot be read is
left out with one run error. No secret is logged, stored or put in an error message (`credentials.scrub`).

HTTP is `urllib` with a timeout, the User-Agent `tao-admin-poc news worker`, and no cookies or personal data.

**What is verified.** The paid adapters are tested against recorded responses shaped from each provider's published
documentation (`fixtures/providers/`), not against live accounts: each is proven live only when a client key is entered
and Test connection passes. The Google batchexecute call is unofficial and tested only with a mocked Google. The Claude
check is tested with recorded answers; `python check_eval.py` (needs `ANTHROPIC_API_KEY`, costs a few cents) runs a
small labelled set, including the four Dynamic Capital cases, against the live model.

## Fixture format (`NEWS_SOURCE=fixture`)

```json
{
  "fail_companies": ["tlfc"],
  "items": [
    {"title": "Test item: ...", "url": "https://example.com/...", "publisher": "Test Wire",
     "published_at": "-2d", "description": "Fictional test data, not a real report.",
     "_check": {"about_company": false, "confidence": 0.95, "reason": "..."},
     "_date_status": "source_only"}
  ]
}
```

- `items` (required): every item is offered to every company; the normal matcher decides which company it belongs to.
- `published_at`: ISO (`2026-11-02T14:00:00Z`), relative to the run (`-2d`, `-3h`, `-30m`), or absent.
- `_date_status` (optional): `confirmed` (default when `published_at` is set), `source_only` (the date becomes
  `source_date`), `unknown`.
- `_check` (optional): the labelled stand-in for the Claude answer. Without it the story is kept at confidence 0.9 with
  categories and sentiment from `screen.py`.
- `fail_companies` (optional): company slugs for which the source raises an error, to drive a `partial` run.
- Fixture mode (`NEWS_SOURCE=fixture`, which implies `NEWS_CHECK=fixture`): no model call, no page reads, no paid
  sources, items never dropped for age.

`fixtures/example.json` covers the five categories, the three sentiments, an alias found only in the description, two
false friends that must not match, a wrong-company "dynamic capital" story the check excludes, and a kept story whose
date is not confirmed. Against the seed companies one run writes 12 news items (11 kept, 1 excluded) and 7 adverse
items; `items_added` is 11.

## Tests

`pip install -r news/requirements-dev.txt`, then `python -m pytest -q` from `news/`. SQLite per test; any real network
call fails the test; the Claude client, article pages and Google links are fakes.
