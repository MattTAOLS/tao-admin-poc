"""One news run: for each company, ask each source, keep the items that name the company, screen them, and write
news_item and adverse_item rows. Errors are recorded per company and source and never stop the run."""
import datetime as dt
import logging

import match
from sources.net import SourceSkipped, lookback
import screen
import store

log = logging.getLogger("news")


def _err(slug, source, message):
    return {"company_slug": slug, "source": source, "message": str(message)[:500]}


def execute(eng, run_id, sources, now=store.utcnow, pre_errors=()):
    """Run a claimed (running) news_run row to the end. Returns the finished row's counts."""
    with eng.connect() as conn:
        companies = store.companies(conn)
        have_items = store.companies_with_items(conn)
    errors = list(pre_errors)
    started = now()                     # one reference time per run (fixture relative dates, look-back)
    successes = 0
    items_added = adverse_added = 0
    fetched = matched = 0
    log.info("news run %s started: %d companies, sources %s", run_id, len(companies), [s.name for s in sources])

    for company in companies:
        slug = company["slug"]
        hit = match.matcher(company)
        found = {}
        max_age = lookback(first=slug not in have_items)     # first search: FIRST_LOOKBACK_DAYS, later LOOKBACK_DAYS
        for src in sources:
            for q in src.queries(company):
                if getattr(src, "skipped", False):
                    break
                try:
                    items = src.fetch(q, started, max_age)
                except SourceSkipped:
                    break
                except Exception as exc:
                    errors.append(_err(slug, src.name, exc))
                    if getattr(src, "skipped", False):      # this failure made the source give up for the run
                        errors.append(_err(None, src.name, getattr(src, "SKIP_MESSAGE", None) or "source skipped"))
                    continue
                successes += 1
                fetched += len(items)
                for it in items:
                    if hit(it) and it["url"] not in found:
                        found[it["url"]] = (src.name, it)
        matched += len(found)
        if not found:
            continue
        try:
            with eng.begin() as conn:
                seen = store.existing_urls(conn, slug)
                for url, (src_name, it) in found.items():
                    if url in seen:
                        continue
                    sentiment, cats = screen.screen(it)
                    t = now()
                    nid = store.new_id()
                    store.insert_item(conn, {"id": nid, "company_slug": slug, "run_id": run_id, "source": src_name,
                                             "title": it["title"], "url": url, "publisher": it.get("publisher"),
                                             "published_at": it.get("published_at"), "sentiment": sentiment,
                                             "found_at": t})
                    for c in cats:
                        store.insert_adverse(conn, {"id": store.new_id(), "company_slug": slug, "news_item_id": nid,
                                                    "category": c, "title": it["title"], "url": url,
                                                    "publisher": it.get("publisher"), "found_at": t, "state": "open"})
                    items_added += 1
                    adverse_added += len(cats)
        except Exception as exc:
            log.exception("news run %s: writing items for %s failed", run_id, slug)
            errors.append(_err(slug, "worker", f"could not save items: {exc}"))

    if not errors:
        status = "ok"
    elif successes or items_added:
        status = "partial"
    else:
        status = "failed"
    with eng.begin() as conn:
        store.finish_run(conn, run_id, status, now(), len(companies), items_added, adverse_added, errors)
    log.info("news run %s finished %s: %d companies, %d fetched, %d matched, %d new items, %d adverse, %d errors",
             run_id, status, len(companies), fetched, matched, items_added, adverse_added, len(errors))
    return {"status": status, "companies": len(companies), "items_added": items_added,
            "adverse_added": adverse_added, "errors": errors}
