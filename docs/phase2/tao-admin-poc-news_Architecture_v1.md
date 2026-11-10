# Wave E: news and adverse media screening, version 2

Status: **design for approval** (2026-11-10). Nothing below is built yet. Wave D's free-source feed (decision D1) stays
in place until this replaces it.

## Why

A test run brought back a PEI Private Equity page titled "Dynamic capital", dated 6 Nov 2026 by Google News. The page was written in May 2009. Three other "Dynamic Capital" stories were about a Mexico City market, SoFi's "dynamic capital strategy" and Albania's capital. Two faults cause this:

1. **We trust the source's date.** Google News `pubDate` and GDELT `seendate` are when the page was indexed or seen, not when it was written.
2. **A name match in the text is enough to keep a story.** Generic names like "Dynamic Capital" match ordinary phrases.

CreditNova was reviewed for a pattern to reuse. It has no working news check: its research agent never runs a search, and it has no date or entity controls. So this design starts fresh.

Matt's decisions (2026-11-10):

- Add paid sources, with client API keys entered in System settings.
- Paid sources: LexisNexis, Dow Jones, Event Registry, NewsCatcher, Brave Search.
- Keys encrypted and write-only.
- Build the full plan: mandatory Claude check, confirmed dates, adverse-term and French queries, and re-checking old stories.

## What changes, in one picture

```
per company, once a day
  search   free: Google News (en-CA + fr-CA), GDELT       paid: Event Registry, NewsCatcher, Brave, Dow Jones*, LexisNexis*
     |     queries: "name", each "alias", "name" + adverse terms (EN + FR), minus the company's exclusions
  pool     one candidate per story: canonical URL; several sources for the same story are merged
     |     drop: already on file (same company + URL), excluded phrase, outside the search window
  date     publisher URL resolved (Google links decoded where possible), page read once, date from the page metadata
     |     -> confirmed | source date only | unknown
  check    Claude (mandatory): is this about THIS company? adverse or not, which categories, sentiment, one-line reason
     |     -> kept | excluded (with reason) | pending (check could not run; retried next run, never shown)
  write    news_item (+ adverse_item per category, Open for TAO review)
  alert    negative_news / adverse_media only for stories first seen this run AND with a confirmed date in the last 7 days
```
\* Dow Jones and LexisNexis: see E1.

## Decisions in this design

| # | Decision | Proposal |
| --- | --- | --- |
| E1 | Paid sources | **Built fully:** Event Registry, NewsCatcher and Brave (news and web search). All three publish their APIs: Event Registry `POST /api/v1/article/getArticles` (`apiKey` in the body); NewsCatcher v3 `GET /api/search` (`x-api-token` header); Brave `/res/v1/news/search` and `/res/v1/web/search` (`X-Subscription-Token` header). **Dow Jones (Factiva) and LexisNexis (Nexis Data+):** their API documentation is released only to contracted clients, so their endpoints cannot be built from public information. The settings section, encrypted credentials (Dow Jones: user key or OAuth client ID/secret plus service account; LexisNexis: client ID/secret) and an adapter slot are built now. Each shows "Needs the client's API documentation" until a client supplies the docs and credentials; then it is a small follow-up. |
| E2 | Claude check | **Mandatory** for every new candidate. Model `claude-haiku-5-5` by default (fast and low cost), set by `NEWS_MODEL` in `.env`, on the Anthropic key extraction already uses. **Input:** the company's name, aliases, industry, headquarters, programs, context words and exclusions, plus the story's title, publisher, URL and up to about 4,000 characters of page text (the snippet when the page cannot be read). **Output, structured:** `about_company` (yes/no), `confidence` 0–1, `adverse` (yes/no), `categories` (the five existing ones), `sentiment`, `published_on` if the text states a date, and a one-line `reason`. **Kept:** about the company with confidence of at least 0.7. **If the check cannot run** (no key, an outage): the story is held as pending and retried, and never shown until checked. The keyword lists stay only as a fallback hint passed to Claude. |
| E3 | Dates | `published_at` is set only from the article itself: JSON-LD `datePublished`, `article:published_time`, `og:published_time`, `<time datetime>`, or a date Claude reads in the text. NewsCatcher's `published_date` (a separate field from its crawl date) and Event Registry's `date` also count as confirmed. Google `pubDate`, GDELT `seendate` and Brave `page_age` are stored as `source_date` only. **`date_status`:** confirmed / source date only / unknown. A story whose confirmed date falls outside the window is dropped. A story without a confirmed date is listed under "Date not confirmed": never counted in "news, last 7 days", never alerted. |
| E4 | Search windows | **First search for a company:** 12 months where a paid archive source with an archive plan is configured. Event Registry and NewsCatcher free tiers cover 30 days, and GDELT covers 3 months, so without a paid archive the first search goes back 3 months. **Every later run:** a 7-day window, so late-indexed stories and a missed run leave no hole. Deduplicated by URL; alerts only for stories not seen before. |
| E5 | Google News links | Decode the redirect to the publisher URL (old-style IDs decode offline; new-style need an unofficial Google call that is often rate-limited). When decoding fails, keep the Google link and treat the date as unconfirmed. Google News becomes a supporting source: paid sources carry the real publisher URL. |
| E6 | Queries | Per company and per language: the exact name in quotes, each alias, and the name plus adverse terms (EN: fraud, lawsuit, insolvency, bankruptcy, receivership, regulator, sanction; FR: fraude, poursuite, faillite, insolvabilité, séquestre, Autorité des marchés financiers, sanction). French queries (`fr-CA` and French in the paid sources) run for companies set to English and French. The default is English and French for Canadian headquarters. |
| E7 | Per-company search settings | On the company record, TAO Admin only, each change with a reason and audited. **Fields:** context words (at least one must appear for a generic name, e.g. Dynamic Capital: leasing, equipment, finance), exclusion phrases (always the wrong company) and languages. Claude gets all three as guidance; the exclusions and the context-word rule are also applied before the check, to save calls. |
| E8 | Client API keys | In System settings, **News sources**: one row per provider, with an on/off switch, a key field, its provider-specific fields, a "Test connection" button (one small query, shows OK or the provider's error) and the last test result. **Keys:** encrypted in the database with `NEWS_SECRET_KEY` from `.env` (Fernet, AES-128 with HMAC). Write-only: the screen and the API only ever show the last 4 characters. Replacing or removing a key is audited without the key. Losing `NEWS_SECRET_KEY` means the keys must be entered again; it is never stored in the database. TAO Admin only. |
| E9 | Re-check what is already on file | A one-off "Re-check stories" action in System settings (also run once on upgrade) puts every existing story through E3 and E2. **Stories that fail:** set to excluded, with the reason shown to TAO, never deleted; their Open adverse items are dismissed with the reason "Excluded by the news check". Adverse items a person already reviewed or dismissed are left as they are. |
| E10 | Cost and visibility | **Each run records:** calls per source, candidates, kept, excluded, pending, and Claude tokens used, all shown on the run in System settings. **Per-source daily cap** (default 200 requests) so a mis-set company cannot burn a client's credits. Brave lists $5 per 1,000 requests; Event Registry and NewsCatcher are per-plan credits. |

## Data and contract changes (Lead)

**Migration `013_wave_e_news.sql`**

- **`news_item`:** new columns
  - `source_date`, `date_status`
  - `resolved_url`, `sources` (text[])
  - `language`
  - `check_status` (kept / excluded / pending), `check_confidence`, `check_reason`, `checked_at`, `check_model`
- **`news_run`:** new columns `stats` (jsonb) and `trigger`, which gains `recheck`.
- **`company`:** new columns `news_context_terms`, `news_exclusions`, `news_languages`.
- **New table `news_source`:** `provider`, `enabled`, `secret_enc`, `secret_last4`, `config` (jsonb, non-secret fields), `last_test_at`, `last_test_ok`, `last_test_message`, `updated_at`, `updated_by`.
- The `news_item.source` check constraint gains the new providers.

**`openapi.yaml`**

- **New endpoints:**
  - `GET /news/sources`
  - `PUT /news/sources/{provider}` (enabled, config, key: write-only, reason)
  - `DELETE /news/sources/{provider}/key`
  - `POST /news/sources/{provider}/test`
  - `POST /news/recheck`
- **Changed:**
  - `company_feeds.sources` accepts the new providers.
  - `NewsItem` gains `date_status`, `source_date`, `sources[]` and `check` (status, reason).
  - Company and CompanyPatch gain the three search fields.
  - The news list hides excluded stories by default; TAO can show them with `?include=excluded`.
- **New audit action:** `news_source_change`. Key values never appear in audit entries or logs.

## Who builds what

| Owner | Work |
| --- | --- |
| Lead | Contract, migration 013, `.env` additions (`NEWS_SECRET_KEY`, `NEWS_MODEL`), fixtures for each provider's response, this document |
| Data & API | `news_source` endpoints, encryption, test-connection proxy to the news worker, recheck endpoint, company search fields, the news list filter and date rules in counts and alerts |
| News | Source adapters (Event Registry, NewsCatcher, Brave news and web, Google News fr-CA, Dow Jones and LexisNexis slots), query builder, pooling, URL resolution and page-date reader, Claude check (structured output, retries, token accounting), windows, daily caps, recheck job |
| UI-Admin | System settings **News sources** section (rows, key fields, test, last result) and "Re-check stories"; run detail with the new counts |
| UI-Partner | Company record search settings (TAO); the news list shows the date status ("Date not confirmed"), the sources, and for TAO the excluded stories with reasons |
| QA | Fixture-mode news run in the demo (Claude check replaced by a labelled fake in fixture mode, so the demo needs no network); the Dynamic Capital false-date and false-name cases as regression checks |

## Testing and honesty about what is verified

- **Paid adapters** are tested against recorded sample responses shaped from each provider's published docs. Each one is proven live only when a client key is entered; "Test connection" exists for that.
- **The Claude check** has unit tests with recorded answers, plus a small labelled set of real headlines, including the four Dynamic Capital cases, run on demand against the live model to report accuracy.
- **Not covered by any source here:** court filings, insolvency registers and regulator notices beyond what news and Brave web search index. Purpose-built screening services (Dow Jones Risk & Compliance, LexisNexis Diligence) cover those, once their API documentation is available.

## Estimate

About four to five days of build across the agents, then the full demo from a fresh database, then a walk in the browser. The same gates as every wave apply: suites green, the demo green, Matt approves before main moves.
