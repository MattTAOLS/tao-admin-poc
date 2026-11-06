"""Deterministic keyword screening: sentiment (positive / neutral / negative) and the five adverse categories. No model
calls, no paid services. The word lists live in screen_terms.json."""
import json
import pathlib
import re

CATEGORIES = ("litigation", "regulatory", "fraud", "insolvency", "sanctions")
TERMS_FILE = pathlib.Path(__file__).with_name("screen_terms.json")


def _compile(words):
    alts = "|".join(r"\s+".join(re.escape(w) for w in term.split()) for term in sorted(words, key=len, reverse=True))
    return re.compile(r"(?<![0-9A-Za-z])(?:" + alts + r")(?![0-9A-Za-z])", re.IGNORECASE)


def load_terms(path=TERMS_FILE):
    data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    missing = [c for c in CATEGORIES if not data["adverse"].get(c)]
    if missing:
        raise ValueError(f"screen_terms.json has no terms for {missing}")
    return data


_T = load_terms()
_ADVERSE = {c: _compile(_T["adverse"][c]) for c in CATEGORIES}
_POS = _compile(_T["sentiment"]["positive"])
_NEG = _compile(_T["sentiment"]["negative"])


def _text(item):
    return f"{item.get('title') or ''}\n{item.get('description') or ''}"


def categories(item):
    text = _text(item)
    return [c for c in CATEGORIES if _ADVERSE[c].search(text)]


def sentiment(item, cats=None):
    text = _text(item)
    cats = categories(item) if cats is None else cats
    if cats:
        return "negative"
    pos, neg = len(_POS.findall(text)), len(_NEG.findall(text))
    if neg > pos:
        return "negative"
    if pos > neg:
        return "positive"
    return "neutral"


def screen(item):
    cats = categories(item)
    return sentiment(item, cats), cats
