"""What to search for one company (decision E6). Per company: the exact name, each alias, and the name plus adverse
terms, in each language in company.news_languages (default en and fr). Each source renders a Query in its own syntax
and decides whether one request covers several languages (Event Registry, NewsCatcher) or one per language (Google
News, Brave, GDELT)."""
from dataclasses import dataclass

LANGS = ("en", "fr")
ADVERSE_TERMS = {
    "en": ("fraud", "lawsuit", "insolvency", "bankruptcy", "receivership", "regulator", "sanction"),
    "fr": ("fraude", "poursuite", "faillite", "insolvabilité", "séquestre", "Autorité des marchés financiers",
           "sanction"),
}


@dataclass(frozen=True)
class Query:
    kind: str                 # name | alias | adverse
    term: str                 # the company name or alias (a phrase)
    langs: tuple              # languages this query covers ("en", "fr")
    adverse: tuple = ()       # adverse terms, kind adverse only (one language)

    def label(self):
        return f"{self.kind}:{self.term}:{','.join(self.langs)}"


def languages(company):
    langs = [x for x in (company.get("news_languages") or LANGS) if x in LANGS]
    return tuple(dict.fromkeys(langs)) or LANGS


def build(company):
    """Name and alias queries cover every language; one adverse query per language."""
    from match import terms
    langs = languages(company)
    names = terms(company)
    out = [Query("name" if i == 0 else "alias", t, langs) for i, t in enumerate(names)]
    if names:
        out += [Query("adverse", names[0], (lang,), ADVERSE_TERMS[lang]) for lang in langs]
    return out


def per_language(queries):
    """For sources that take one language per request: split name and alias queries by language."""
    out = []
    for q in queries:
        if len(q.langs) == 1:
            out.append(q)
        else:
            out += [Query(q.kind, q.term, (lang,), q.adverse) for lang in q.langs]
    return out


def quote(term):
    return '"' + term.replace('"', "").strip() + '"'


def boolean_text(q, and_word=" AND "):
    """`"name"` or `"name" AND (fraud OR lawsuit OR "Autorité des marchés financiers")`."""
    phrase = quote(q.term)
    if q.kind != "adverse":
        return phrase
    alts = " OR ".join(quote(t) if " " in t else t for t in q.adverse)
    return f"{phrase}{and_word}({alts})"
