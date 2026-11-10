"""The date check: Google News link decoding and the article page reader (no network)."""
import base64
import datetime as dt
import json

import pytest

import pages
from sources import google_links, google_news
from sources.net import SourceError
from conftest import PAGES, UTC, provider_body

NOW = dt.datetime(2026, 11, 6, 12, 0, tzinfo=UTC)


def old_style(url):
    raw = b"\x08\x13\x22" + bytes([len(url)]) + url.encode() + b"\xd2\x01\x00"
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


# --- Google links ------------------------------------------------------------------------------------------------

def test_old_style_ids_decode_offline():
    [it] = google_news.parse(provider_body("google_news.xml"), NOW)
    assert google_links.resolve(it["url"], online=False) == "https://example.com/pe-magazine/2009/05/dynamic-capital"
    aid = old_style("https://example.com/a?b=1")
    assert google_links.resolve(f"https://news.google.com/rss/articles/{aid}?oc=5") == "https://example.com/a?b=1"


def test_long_urls_use_a_two_byte_length():
    url = "https://example.com/" + "x" * 200
    raw = b"\x08\x13\x22" + bytes([len(url) & 0x7F | 0x80, len(url) >> 7]) + url.encode()
    aid = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    assert google_links.decode_offline(aid) == url


def test_new_style_ids_fail_gracefully():
    token = "AU_yqLtest-token-value"
    raw = b"\x08\x13\x22" + bytes([len(token)]) + token.encode()
    aid = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    assert google_links.decode_offline(aid) is None

    def down(url, **kw):
        raise SourceError("HTTP 429")
    assert google_links.resolve(f"https://news.google.com/rss/articles/{aid}", http=down) is None

    def no_attrs(url, **kw):
        return url, b"<html>consent page</html>", "text/html"
    assert google_links.resolve(f"https://news.google.com/rss/articles/{aid}", http=no_attrs) is None

    def garbage(url, **kw):
        if "batchexecute" in url:
            return url, b")]}'\n\nnot json", "text/plain"
        return url, b'<div data-n-a-sg="SIG" data-n-a-ts="1762400000"></div>', "text/html"
    assert google_links.resolve(f"https://news.google.com/rss/articles/{aid}", http=garbage) is None


def test_new_style_online_decode_with_a_mocked_google():
    aid = "CBMiAU_yqLnewstyle"
    seen = []

    def fake(url, timeout=None, method="GET", data=None, headers=None, **kw):
        seen.append((url, method, timeout, data))
        if method == "GET":
            return url, b'<c-wiz><div jscontroller="x" data-n-a-sg="SIG123" data-n-a-ts="1762400000"></div>', "text/html"
        inner = json.dumps(["garturlres", "https://example.com/real-article", 1])
        return url, (")]}'\n\n" + json.dumps([["wrb.fr", "Fbv4je", inner, None, None, None, "generic"]])).encode(), "x"
    assert google_links.decode_online(aid, http=fake) == "https://example.com/real-article"
    assert seen[0][2] == 10 and seen[1][0] == google_links.BATCH_URL and seen[1][1] == "POST"
    assert b"Fbv4je" in seen[1][3] and b"SIG123" in seen[1][3]


def test_non_google_links_are_left_alone():
    assert google_links.resolve("https://example.com/story") is None


# --- page dates and text -----------------------------------------------------------------------------------------

def test_json_ld_graph_date_wins_over_the_modified_date():
    out = pages.extract((PAGES / "pe-2009-dynamic-capital.html").read_text(encoding="utf-8"), NOW)
    assert out["date"] == dt.datetime(2009, 5, 12, 9, 30, tzinfo=UTC)
    assert out["date_from"] == "json-ld datePublished"
    assert "Private equity" in out["text"] and "window.analytics" not in out["text"] and "Home | Funds" not in out["text"]
    assert out["title"].startswith("Test item: Dynamic capital")


def test_article_published_time_before_og_and_timezone_converted():
    out = pages.extract((PAGES / "meta-og.html").read_text(encoding="latin-1"), NOW)
    assert out["date"] == dt.datetime(2026, 11, 4, 15, 15, tzinfo=UTC)
    assert out["date_from"] == "meta article:published_time"
    assert "crédit-bail" in out["text"]


@pytest.mark.parametrize("html, expected", [
    ('<meta property="og:article:published_time" content="2026-10-01">', dt.datetime(2026, 10, 1, tzinfo=UTC)),
    ('<meta property="og:published_time" content="2026-10-02T08:00:00Z">', dt.datetime(2026, 10, 2, 8, tzinfo=UTC)),
    ('<span itemprop="datePublished" content="2026-10-03T08:00:00+0000">x</span>', dt.datetime(2026, 10, 3, 8, tzinfo=UTC)),
    ('<p>Posted <time datetime="2026-10-04T12:00:00-04:00">Oct 4</time></p>', dt.datetime(2026, 10, 4, 16, tzinfo=UTC)),
    ('<script type="application/ld+json">[{"@type":"Article","datePublished":"2026-10-05"}]</script>',
     dt.datetime(2026, 10, 5, tzinfo=UTC)),
])
def test_each_date_source(html, expected):
    assert pages.extract(f"<html><head>{html}</head><body></body></html>", NOW)["date"] == expected


def test_no_date_future_dates_and_bad_json_ld_are_ignored():
    assert pages.extract("<p>no date here</p>", NOW)["date"] is None
    assert pages.extract('<meta property="article:published_time" content="2027-06-01">', NOW)["date"] is None
    assert pages.extract('<script type="application/ld+json">{not json</script><time datetime="2026-11-01">x</time>',
                         NOW)["date"] == dt.datetime(2026, 11, 1, tzinfo=UTC)


def test_text_is_trimmed_to_about_4000_characters():
    html = "<p>" + ("word " * 3000) + "</p>"
    assert len(pages.extract(html, NOW)["text"]) == pages.TEXT_CHARS


def test_read_uses_the_limits_and_rejects_non_html():
    seen = {}

    def fake(url, **kw):
        seen.update(kw)
        return "https://example.com/final", (PAGES / "meta-og.html").read_bytes(), "text/html; charset=iso-8859-1"
    out = pages.read("https://example.com/x", NOW, http=fake)
    assert seen["timeout"] == 10 and seen["max_bytes"] == 1_500_000 and seen["truncate"] is True
    assert out["final_url"] == "https://example.com/final" and "crédit-bail" in out["text"]

    def pdf(url, **kw):
        return url, b"%PDF", "application/pdf"
    with pytest.raises(SourceError, match="not an HTML page"):
        pages.read("https://example.com/x.pdf", NOW, http=pdf)


# --- audit M12: a page wrapped in a <form>; a headline inside <article><header> ----------------------------------

def test_an_article_wrapped_in_a_form_keeps_its_text():
    body = "TLFC, the equipment leasing company, was sued today. " * 10
    html = ("<html><head><title>T</title></head><body><form id='aspnetForm'><input type='hidden' name='__VIEWSTATE' "
            "value='abc'><nav><p>Menu item</p></nav><div><p>" + body + "</p></div><button>Subscribe now</button>"
            "<select><option>Pick a region</option></select><textarea>Your comment</textarea></form></body></html>")
    text = pages.extract(html, NOW)["text"]
    assert text.startswith("TLFC, the equipment leasing company, was sued today.")
    for chrome in ("Menu item", "Subscribe now", "Pick a region", "Your comment"):
        assert chrome not in text


def test_header_is_page_chrome_outside_the_article_and_the_headline_inside_it():
    html = ("<body><header><div>Site banner and login</div></header><main><article><header><h1>TLFC sued over leases"
            "</h1><div>By A. Writer</div></header><div>Short body.</div><footer>Filed under courts</footer></article>"
            "</main><footer><div>Copyright notice</div></footer></body>")
    text = pages.extract(html, NOW)["text"]
    assert "TLFC sued over leases" in text and "By A. Writer" in text and "Filed under courts" in text
    assert "Site banner" not in text and "Copyright notice" not in text
