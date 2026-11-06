from match import matcher, terms

ESSEX = {"slug": "essex", "name": "Essex Lease Financial Corp.", "aliases": ["Essex Lease Financial"]}
TLFC = {"slug": "tlfc", "name": "TLFC", "aliases": []}
FINLOC = {"slug": "finloc", "name": "Finloc 2000 Inc.", "aliases": ["Finloc 2000"]}


def m(company, title, description=""):
    return matcher(company)({"title": title, "description": description})


def test_name_and_alias_whole_phrase_case_insensitive():
    assert m(ESSEX, "essex lease financial corp. opens office")
    assert m(ESSEX, "News about ESSEX LEASE FINANCIAL today")
    assert m(ESSEX, "Essex   Lease\nFinancial expands")          # any whitespace between words
    assert m(ESSEX, "Nothing here", "A note on Essex Lease Financial.")   # description counts


def test_partial_words_do_not_match():
    assert not m(ESSEX, "Essex Lease Financing Ltd faces petition")
    assert not m(ESSEX, "Essex Lease opens")                     # part of the phrase only
    assert not m(FINLOC, "Finloc 20000 launches")
    assert m(FINLOC, "Finloc 2000's new office")


def test_short_all_caps_alias_matches_as_a_word_only():
    assert m(TLFC, "TLFC reports results")
    assert m(TLFC, "Leasing firm (TLFC) reports")
    assert m(TLFC, "tlfc reports")
    assert not m(TLFC, "TLFCX Holdings sued")
    assert not m(TLFC, "ATLFC opens")
    assert not m(TLFC, "TLFC2 fund")


def test_terms_dedupe_and_skip_blank():
    assert terms({"name": "TLFC", "aliases": ["tlfc", "", "  "]}) == ["TLFC"]
