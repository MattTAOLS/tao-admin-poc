"""One news run (wave E, docs/phase2/tao-admin-poc-news_Architecture_v1.md). Per company:

  search   every source, every query (queries.py), inside the search window; daily cap per source
  pool     one candidate per canonical URL; the sources that found it are merged
  filter   drop: already on file, an exclusion phrase, no whole-phrase name match
  date     Google links resolved, the article page read once, the date from its metadata
           -> confirmed | source_only | unknown; a confirmed date outside the window drops the story;
           context terms (when set) must appear in the title, snippet or page text
  check    Claude: kept | excluded (with the reason) | pending (the check could not run; retried next run)
  write    news_item, plus one adverse_item per category for a kept adverse story (state open)

Before searching, stories left pending by an earlier run are checked again. A `recheck` run (E9) instead puts every
unchecked or pending story through the date check and the Claude check; it never deletes a row. Errors are recorded per
company and source and never stop the run; no message can carry a secret (credentials.scrub)."""
import datetime as dt
import logging

import check as check_mod
import feeds
import match
import pages
import screen
import store
import urls
from credentials import scrub
from sources import google_links
from sources.net import SourceSkipped, lookback

log = logging.getLogger("news")
EXCLUDED_NOTE = "Excluded by the news check: {reason}"


def new_stats():
    return {"calls": {}, "capped": [], "candidates": 0, "kept": 0, "excluded": 0, "pending": 0, "date_confirmed": 0,
            "claude_input_tokens": 0, "claude_output_tokens": 0}


def _phrase_in(text, phrases):
    """Context words and exclusions: whole phrases, case- and accent-insensitive (match.phrases_in)."""
    return match.phrases_in(text, phrases)


def _midnight(d):
    return dt.datetime.combine(d, dt.time(), tzinfo=dt.timezone.utc)


class Run:
    def __init__(self, eng, run_id, now=store.utcnow, checker=None, cfg=None, page_reader=pages.read,
                 resolver=google_links.resolve, secrets=(), pre_errors=(), read_pages=True):
        self.eng, self.run_id, self.now = eng, run_id, now
        self.checker = checker or check_mod.FixtureChecker()
        self.cfg = cfg or feeds.settings(None)
        self.page_reader, self.resolver = page_reader, resolver
        self.secrets = [s for s in secrets if s]
        self.read_pages = read_pages
        self.errors = [self._clean(e) for e in pre_errors]
        self.stats = new_stats()
        self.items_added = self.adverse_added = 0
        self.successes = 0
        self.companies_n = 0
        self.started = now()
        self._check_errors = set()

    # --- bookkeeping ---------------------------------------------------------------------------------------------

    def _clean(self, e):
        return {"company_slug": e.get("company_slug"), "source": e.get("source"),
                "message": scrub(str(e.get("message")), self.secrets)[:500]}

    def err(self, slug, source, message):
        self.errors.append(self._clean({"company_slug": slug, "source": source, "message": message}))

    def save(self):
        with self.eng.begin() as conn:
            store.save_progress(conn, self.run_id, self.companies_n, self.items_added, self.adverse_added, self.errors,
                                self.stats)

    def finish(self):
        if not self.errors:
            status = "ok"
        elif self.successes or self.items_added:
            status = "partial"
        else:
            status = "failed"
        with self.eng.begin() as conn:
            store.finish_run(conn, self.run_id, status, self.now(), self.companies_n, self.items_added,
                             self.adverse_added, self.errors, self.stats)
        log.info("news run %s finished %s: %d companies, %d new items, %d adverse, stats %s, %d errors",
                 self.run_id, status, self.companies_n, self.items_added, self.adverse_added, self.stats,
                 len(self.errors))
        return {"status": status, "companies": self.companies_n, "items_added": self.items_added,
                "adverse_added": self.adverse_added, "errors": self.errors, "stats": self.stats}

    # --- the Claude check ----------------------------------------------------------------------------------------

    def judge(self, company, story):
        """A Verdict, or None when the check could not run (the story stays pending)."""
        try:
            v = self.checker.check(company, story)
        except check_mod.CheckUnavailable as exc:
            msg = scrub(str(exc), self.secrets)
            if msg not in self._check_errors:
                self._check_errors.add(msg)
                self.err(None, "claude", msg)
            self.stats["pending"] += 1
            return None
        self.successes += 1
        self.stats["claude_input_tokens"] += v.input_tokens
        self.stats["claude_output_tokens"] += v.output_tokens
        self.stats["kept" if v.kept else "excluded"] += 1
        return v

    # --- the date check ------------------------------------------------------------------------------------------

    def resolve(self, story):
        if urls.host(story["url"]) == "news.google.com" and not story.get("resolved_url"):
            try:
                found = self.resolver(story["url"])
            except AssertionError:
                raise
            except Exception:
                found = None
            if found:
                story["resolved_url"] = found

    def read_page(self, story):
        """Read the article once: page date (confirmed) and page text. Failures leave the story as it is."""
        if not (self.read_pages and story.get("fetch_pages", True)):
            return
        target = story.get("resolved_url") or story["url"]
        if urls.host(target) == "news.google.com":          # an unresolved Google link is not the article
            return
        try:
            page = self.page_reader(target, self.started)
        except AssertionError:
            raise
        except Exception as exc:
            log.info("page not read (%s): %s", type(exc).__name__, target)
            return
        if page.get("date") is not None:
            story["published_at"] = page["date"]
        if page.get("text"):
            story["text"] = page["text"]
        final = page.get("final_url")
        if final and urls.host(final) not in ("", "news.google.com") and urls.canonical(final) != urls.canonical(target):
            story["resolved_url"] = final

    @staticmethod
    def date_status(story):
        if story.get("_date_status") in ("confirmed", "source_only", "unknown") and story.get("source") == "fixture":
            if story["_date_status"] == "confirmed" and story.get("published_at") is None:
                return "unknown"
            return story["_date_status"]
        if story.get("published_at") is not None:
            return "confirmed"
        return "source_only" if story.get("source_date") is not None else "unknown"

    # --- pending retries and the re-check ------------------------------------------------------------------------

    def recheck_rows(self, statuses, by_slug):
        """Date check and Claude check for stored stories with one of `statuses`. Kept: new adverse categories are
        written. Excluded: their open adverse items are dismissed. Pending: left for the next run. Never deletes."""
        with self.eng.connect() as conn:
            rows = store.items_to_check(conn, statuses)
        for row in rows:
            company = by_slug.get(row["company_slug"])
            if company is None:
                continue
            self.stats["candidates"] += 1
            story = {"title": row["title"], "url": row["url"], "resolved_url": row.get("resolved_url"),
                     "publisher": row.get("publisher"), "published_at": store.as_utc(row.get("published_at")),
                     "source_date": store.as_utc(row.get("source_date")), "description": row.get("description") or "",
                     "text": row.get("description") or "", "language": row.get("language"), "source": row["source"],
                     "fetch_pages": row["source"] != "fixture"}
            if story["published_at"] is None or not story["text"]:
                self.resolve(story)
                self.read_page(story)
            verdict = self.judge(company, story)
            now = self.now()
            values = {"resolved_url": story.get("resolved_url"), "description": (story.get("text") or "")[:4000] or None}
            if verdict is not None and verdict.published_on and story.get("published_at") is None:
                story["published_at"] = _midnight(verdict.published_on)
            values["published_at"] = story.get("published_at")
            values["date_status"] = self.date_status(story)
            try:
                with self.eng.begin() as conn:
                    if verdict is None:          # an unchecked row stays unchecked (shown as before); pending stays
                        values.update(check_status="unchecked" if row["check_status"] == "unchecked" else "pending")
                        store.update_item(conn, row["id"], values)
                        continue
                    values.update(check_status=verdict.status, check_confidence=verdict.confidence,
                                  check_reason=verdict.reason, check_model=verdict.model, checked_at=now,
                                  sentiment=verdict.sentiment)
                    store.update_item(conn, row["id"], values)
                    if values["date_status"] == "confirmed":
                        self.stats["date_confirmed"] += 1
                    if verdict.kept:
                        if row["check_status"] == "pending":
                            self.items_added += 1
                        have = store.adverse_categories(conn, row["company_slug"], row["url"])
                        for c in verdict.adverse_categories:
                            if c not in have:
                                store.insert_adverse(conn, {
                                    "id": store.new_id(), "company_slug": row["company_slug"], "news_item_id": row["id"],
                                    "category": c, "title": row["title"], "url": row["url"],
                                    "publisher": row.get("publisher"), "found_at": now, "state": "open"})
                                self.adverse_added += 1
                    else:
                        store.dismiss_open_adverse(conn, row["id"], EXCLUDED_NOTE.format(reason=verdict.reason or
                                                                                         "not about this company"), now)
            except Exception as exc:
                log.exception("news run %s: updating a checked story failed", self.run_id)
                self.err(row["company_slug"], "worker", f"could not save the check: {exc}")
        return len(rows)

    # --- one company ---------------------------------------------------------------------------------------------

    def search(self, company, sources, window, used, cap):
        slug = company["slug"]
        found = {}
        for src in sources:
            if src.name in self.stats["capped"]:
                continue
            for q in src.queries(company):
                if getattr(src, "skipped", False):
                    break
                if used.get(src.name, 0) + self.stats["calls"].get(src.name, 0) >= cap:
                    self.stats["capped"].append(src.name)
                    log.warning("news run %s: %s reached its daily cap of %d requests", self.run_id, src.name, cap)
                    break
                self.stats["calls"][src.name] = self.stats["calls"].get(src.name, 0) + 1
                try:
                    items = src.fetch(q, self.started, None if getattr(src, "ignore_window", False) else window)
                except SourceSkipped:
                    break
                except Exception as exc:
                    self.err(slug, src.name, scrub(str(exc), list(getattr(src, "secrets", {}).values())))
                    if getattr(src, "skipped", False):
                        self.err(None, src.name, getattr(src, "SKIP_MESSAGE", None) or "source skipped")
                    continue
                self.successes += 1
                for it in items:
                    self.pool(found, it, src)
        return found

    @staticmethod
    def pool(found, it, src):
        if not it.get("url") or not it.get("title"):
            return
        key = urls.canonical(it["url"])
        have = found.get(key)
        if have is None:
            story = dict(it)
            story.update(canon=key, source=src.name, sources=[src.name],
                         fetch_pages=getattr(src, "fetch_pages", True),
                         ignore_window=getattr(src, "ignore_window", False))
            if getattr(src, "paid", False) and not story.get("resolved_url"):
                story["resolved_url"] = it["url"]             # paid sources give the publisher URL
            found[key] = story
            return
        if src.name not in have["sources"]:
            have["sources"].append(src.name)
        for k in ("published_at", "source_date", "publisher", "language", "resolved_url"):
            if have.get(k) is None and it.get(k) is not None:
                have[k] = it[k]
        for k in ("description", "text"):
            if len(it.get(k) or "") > len(have.get(k) or ""):
                have[k] = it[k]
        if getattr(src, "paid", False) and not have.get("resolved_url"):
            have["resolved_url"] = it["url"]
        have["ignore_window"] = have["ignore_window"] and getattr(src, "ignore_window", False)

    def company(self, company, sources, window, used, cap):
        slug = company["slug"]
        found = self.search(company, sources, window, used, cap)
        self.stats["candidates"] += len(found)
        if not found:
            return
        hit = match.matcher(company)
        excl = company.get("news_exclusions") or []
        context = company.get("news_context_terms") or []
        with self.eng.connect() as conn:
            on_file = store.existing_urls(conn, slug)

        def text_of(s):
            return f"{s.get('title') or ''}\n{s.get('description') or ''}\n{s.get('text') or ''}"

        stories = [s for s in found.values()
                   if s["canon"] not in on_file and not _phrase_in(text_of(s), excl) and hit(
                       {"title": s.get("title"), "description": f"{s.get('description') or ''}\n{s.get('text') or ''}"})]

        # Google links to publisher URLs, then pool again: a Google story and a paid one may be the same article.
        pooled = {}
        for s in stories:
            self.resolve(s)
            key = urls.canonical(s.get("resolved_url") or s["url"])
            if key in on_file or (s.get("resolved_url") and urls.canonical(s["resolved_url"]) in on_file):
                continue
            if key in pooled:
                have = pooled[key]
                for n in s["sources"]:
                    if n not in have["sources"]:
                        have["sources"].append(n)
                for k in ("published_at", "source_date", "publisher", "language"):
                    if have.get(k) is None and s.get(k) is not None:
                        have[k] = s[k]
                continue
            pooled[key] = s

        for s in pooled.values():
            self.read_page(s)
            if not s.get("ignore_window") and s.get("published_at") is not None \
                    and self.started - s["published_at"] > window:
                continue                                        # confirmed date outside the window
            if _phrase_in(s.get("text"), excl):
                continue
            if context and not _phrase_in(text_of(s), context):
                continue
            verdict = self.judge(company, s)
            if verdict is not None and verdict.published_on and s.get("published_at") is None:
                s["published_at"] = _midnight(verdict.published_on)
                if not s.get("ignore_window") and self.started - s["published_at"] > window:
                    continue
            self.write(company, s, verdict)

    def write(self, company, s, verdict):
        slug = company["slug"]
        t = self.now()
        nid = store.new_id()
        url = s.get("resolved_url") or s["url"]
        if verdict is None:
            sentiment, _ = screen.screen(s)
            check = {"check_status": "pending", "check_reason": None}
            cats = []
        else:
            sentiment = verdict.sentiment
            check = {"check_status": verdict.status, "check_confidence": verdict.confidence,
                     "check_reason": verdict.reason, "check_model": verdict.model, "checked_at": t}
            cats = verdict.adverse_categories
        status = self.date_status(s)
        row = {"id": nid, "company_slug": slug, "run_id": self.run_id, "source": s["source"], "title": s["title"],
               "url": url, "publisher": s.get("publisher"),
               "published_at": s.get("published_at") if status == "confirmed" else None,
               "source_date": s.get("source_date"), "date_status": status, "resolved_url": s.get("resolved_url"),
               "sources": list(s["sources"]), "language": s.get("language") if s.get("language") in ("en", "fr") else None,
               "description": ((s.get("text") or s.get("description") or "")[:4000]) or None,
               "sentiment": sentiment, "found_at": t, **check}
        try:
            with self.eng.begin() as conn:
                store.insert_item(conn, row)
                for c in cats:
                    store.insert_adverse(conn, {"id": store.new_id(), "company_slug": slug, "news_item_id": nid,
                                                "category": c, "title": s["title"], "url": url,
                                                "publisher": s.get("publisher"), "found_at": t, "state": "open"})
        except Exception as exc:
            log.exception("news run %s: writing an item for %s failed", self.run_id, slug)
            self.err(slug, "worker", f"could not save items: {exc}")
            return
        if row["check_status"] == "kept":
            if status == "confirmed":                   # dates confirmed: kept stories only, like the kept count
                self.stats["date_confirmed"] += 1
            self.items_added += 1
            self.adverse_added += len(cats)


def execute(eng, run_id, sources, now=store.utcnow, pre_errors=(), checker=None, cfg=None, archive=False,
            page_reader=pages.read, resolver=google_links.resolve, secrets=(), read_pages=True, only=None):
    """Run a claimed (running) schedule or manual news_run to the end: pending retries, then the search. `only` is a
    company slug: the run covers that company alone (its pending stories and its search)."""
    cfg = cfg or feeds.settings(None)
    run = Run(eng, run_id, now, checker, cfg, page_reader, resolver, secrets, pre_errors, read_pages)
    with eng.connect() as conn:
        companies = store.companies(conn)
        have_items = store.companies_with_items(conn)
        used = store.calls_since(conn, feeds.day_start_utc(run.started, cfg["time_zone"]), exclude_run=run_id)
    if only:
        companies = [c for c in companies if c["slug"] == only]
    by_slug = {c["slug"]: c for c in companies}
    log.info("news run %s started: %d companies, sources %s, check %s", run_id, len(companies),
             [s.name for s in sources], getattr(run.checker, "mode", "?"))
    run.recheck_rows(("pending",), by_slug)
    for company in companies:
        window = lookback(first=company["slug"] not in have_items, archive=archive)
        try:
            run.company(company, sources, window, used, cfg.get("daily_cap", 200))
        except Exception as exc:
            if isinstance(exc, AssertionError):
                raise
            log.exception("news run %s: company %s failed", run_id, company["slug"])
            run.err(company["slug"], "worker", str(exc))
        run.companies_n += 1
        run.save()
    run.companies_n = len(companies)
    return run.finish()


def execute_recheck(eng, run_id, now=store.utcnow, checker=None, page_reader=pages.read,
                    resolver=google_links.resolve, read_pages=True):
    """A recheck run (E9): every unchecked or pending story through the date check and the Claude check."""
    run = Run(eng, run_id, now, checker, None, page_reader, resolver, (), (), read_pages)
    with eng.connect() as conn:
        companies = store.companies(conn)
    n = run.recheck_rows(("unchecked", "pending"), {c["slug"]: c for c in companies})
    run.companies_n = len({c["slug"] for c in companies})
    if n == 0 and not run.errors:
        run.successes += 1
    return run.finish()
