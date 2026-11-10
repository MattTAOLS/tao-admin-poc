"""Does an item mention the company? Whole phrase, case-insensitive and accent-insensitive, on the name and each alias,
in the title or the description. "Whole phrase" means no letter or digit directly before or after it, so "TLFC" matches
"TLFC reports" and "(TLFC)" but not "TLFCX" or "ATLFC", and "Finloc 2000" does not match "Finloc 20000". Runs of spaces
in a name match any whitespace. Accents are folded on both sides ("Montreal" matches "Montréal", "equipement" matches
"équipement"). The same rule serves the context words and the exclusion phrases (`phrases_in`), so "art" does not match
"party"."""
import re
import unicodedata

_EXTRA = str.maketrans({"œ": "oe", "Œ": "OE", "æ": "ae", "Æ": "AE", "ß": "ss", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L",
                        "’": "'", "‘": "'", "ʼ": "'"})


def fold(text):
    """Accents removed (é -> e, ç -> c, œ -> oe); case is left to the pattern."""
    text = unicodedata.normalize("NFKD", (text or "").translate(_EXTRA))
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def _pattern(term):
    words = [re.escape(w) for w in fold(term).split()]
    return re.compile(r"(?<![^\W_])" + r"\s+".join(words) + r"(?![^\W_])", re.IGNORECASE)


def terms(company):
    seen, out = set(), []
    for t in [company["name"], *company.get("aliases", [])]:
        t = (t or "").strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def phrases_in(text, phrases):
    """The phrases (context words, exclusions) that appear in the text as whole phrases."""
    folded = fold(text)
    return [p for p in phrases or [] if isinstance(p, str) and p.strip() and _pattern(p).search(folded)]


def matcher(company):
    pats = [_pattern(t) for t in terms(company)]

    def hit(item):
        text = fold(f"{item.get('title') or ''}\n{item.get('description') or ''}")
        return any(p.search(text) for p in pats)
    return hit
