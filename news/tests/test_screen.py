import pytest

import screen


def s(title, description=""):
    return screen.screen({"title": title, "description": description})


@pytest.mark.parametrize("title,category", [
    ("Lender named in lawsuit", "litigation"),
    ("Customer sued the lessor", "litigation"),
    ("Statement of claim filed against lessor", "litigation"),
    ("Securities commission opens hearing", "regulatory"),
    ("Lessor fined by provincial body", "regulatory"),
    ("Enforcement notice issued", "regulatory"),
    ("Former officer charged with fraud", "fraud"),
    ("Fraudulent invoices found", "fraud"),
    ("Misrepresentation alleged in prospectus", "fraud"),
    ("Firm seeks creditor protection", "insolvency"),
    ("Court grants CCAA order", "insolvency"),
    ("Company files BIA proposal", "insolvency"),
    ("Receivership ordered for lessor", "insolvency"),
    ("Lessor enters bankruptcy", "insolvency"),
    ("Counterparty added to sanctions", "sanctions"),
    ("Owner sanctioned abroad", "sanctions"),
])
def test_each_category(title, category):
    sentiment, cats = s(title)
    assert category in cats
    assert sentiment == "negative"


@pytest.mark.parametrize("title", [
    "Bonds issued by the lessor",            # issued is not sued
    "Lessor pursued new markets",            # pursued is not sued
    "Refined pricing defined by the board",   # not fined
    "A new receiver unit for the plant",     # receiver alone is not receivership
    "Fine weather for the lessor's open house",   # fine alone is not 'fined' or 'fine of'
    "Lessor opens CCAAX desk",   # CCAAX is not CCAA
])
def test_false_friends_do_not_hit(title):
    assert s(title)[1] == []


def test_one_item_can_hit_several_categories():
    assert s("Regulator opens enforcement review after fraud allegation")[1] == ["regulatory", "fraud"]


def test_description_is_screened():
    assert s("Quiet day", "A lawsuit was filed")[1] == ["litigation"]


@pytest.mark.parametrize("title,expected", [
    ("Lessor expands after record growth", "positive"),
    ("Lessor publishes quarterly newsletter", "neutral"),
    ("Lessor reports decline in volumes", "negative"),
    ("Record loss reported", "neutral"),        # one positive, one negative word
])
def test_sentiment(title, expected):
    assert s(title) == (expected, [])


def test_terms_file_has_all_five_categories_and_both_word_lists():
    data = screen.load_terms()
    assert set(data["adverse"]) == set(screen.CATEGORIES)
    assert data["sentiment"]["positive"] and data["sentiment"]["negative"]
