"""Does an item mention the company? Whole phrase, case-insensitive, on the name and each alias, in the title or the
description. "Whole phrase" means no letter or digit directly before or after it, so "TLFC" matches "TLFC reports" and
"(TLFC)" but not "TLFCX" or "ATLFC", and "Finloc 2000" does not match "Finloc 20000". Runs of spaces in a name match
any whitespace."""
import re


def _pattern(term):
    words = [re.escape(w) for w in term.split()]
    return re.compile(r"(?<![0-9A-Za-z])" + r"\s+".join(words) + r"(?![0-9A-Za-z])", re.IGNORECASE)


def terms(company):
    seen, out = set(), []
    for t in [company["name"], *company.get("aliases", [])]:
        t = (t or "").strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


def matcher(company):
    pats = [_pattern(t) for t in terms(company)]

    def hit(item):
        text = f"{item.get('title') or ''}\n{item.get('description') or ''}"
        return any(p.search(text) for p in pats)
    return hit
