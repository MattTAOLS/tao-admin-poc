# Recorded provider responses (test data)

Shaped from each provider's published API documentation, not captured from a live account: no client key has been
entered yet. Every headline is invented, starts with "Test item:" and every URL points at example.com. The parsers in
`news/sources/paid.py` are tested against these files (`news/tests/test_providers.py`); each adapter is proven live
only when a client key is entered and "Test connection" passes.

| File | Provider and endpoint | Documented fields used |
| --- | --- | --- |
| `event_registry.json` | Event Registry `POST /api/v1/article/getArticles` | `articles.results[]`: title, url, source.title, lang, body, date, time, dateTime, dateTimePub |
| `event_registry_error.json` | the same, a refused key | `error` |
| `newscatcher.json` | NewsCatcher v3 `GET /api/search` | `articles[]`: title, link, name_source, published_date, published_date_precision, parse_date, description, content, language |
| `brave_news.json` | Brave `GET /res/v1/news/search` | `results[]`: title, url, description, page_age, meta_url.hostname, extra_snippets |
| `brave_web.json` | Brave `GET /res/v1/web/search` | `web.results[]`: the same fields |
| `brave_error.json` | Brave, a refused key | `type: ErrorResponse`, `error.detail` |
| `google_news.xml` | Google News RSS search | `item`: title, link, pubDate, description, source |
