"""Wave D companies (contract lead/wave-d): seed, the 13 routes, partner gating and scope, notes kept TAO-only, insights
checked against docs/dashboard-json, next_report, news and adverse reads (rows inserted the way the news worker writes
them), notifications from the sweep, settings and audit."""
import datetime as dt, json, statistics, uuid
import pytest
from sqlalchemy import select
from conftest import TAO, ANALYST, INV, MGR, REF, reference_deal
from test_users import A1, A2, AN, IA, IV, MA, MV, H, code
from app import db, seed, companies, jobs
from app.main import app
from app.models import (Company, Deal, NewsRun, NewsItem, AdverseItem, CompanyNote, Notification, ReviewAction, SetrepUpload, utcnow)

V1 = "/api/v1"
ESSEX = "move-trust-essex-lease-financial-corp"
MONEDA = "f-pil-2-0-moneda-capital-corp"
INV_ADMIN = {"X-Role": "investor_admin", "X-Partner": "investor"}
MGR_ADMIN = {"X-Role": "manager_admin", "X-Partner": "manager"}
PARTNERS = [INV, INV_ADMIN, MGR, MGR_ADMIN]
NOTE = "Interest coverage inside the watch band; asked the servicer for Q3 accounts."


@pytest.fixture
def published():
    with db.session() as s:
        seed.load_reference_publications(s)


@pytest.fixture
def news_queue():
    q = jobs.ListQueue()
    app.dependency_overrides[jobs.get_news_queue] = lambda: q
    yield q
    app.dependency_overrides.pop(jobs.get_news_queue, None)


def setting(client, key, value):
    r = client.put(V1 + f"/settings/{key}", headers=TAO, json={"value": value, "reason": "test switch"})
    assert r.status_code == 200, r.text
    return r.json()["value"]


def profiles_on(client, on=True):
    setting(client, "company_profiles_partner_enabled", on)


def share_fpil_with_investor_only(client):
    body = {"slug": "f-pil-2-0", "name": "F-PIL 2.0", "partner_slugs": ["investor"], "currency": "CAD", "limit": 150000000.0, "warehouse_limit": 5000000.0}
    assert client.put(V1 + "/master/programs", headers=TAO, json=body).status_code == 200


def rows(client, headers, **params):
    r = client.get(V1 + "/companies", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return {x["slug"]: x for x in r.json()}


def finished_run(status="ok", at=None):
    with db.session() as s:
        r = NewsRun(trigger="schedule", status=status, started_at=at or utcnow(), finished_at=at or utcnow(), companies=10)
        s.add(r); s.commit()
        return r.id


def news(slug, title, sentiment="neutral", url=None, found=None, run_id=None, check="kept", confirmed=True, **extra):
    """A story as the wave E news worker writes it: kept by the Claude check with a confirmed date, unless told otherwise
    (confirmed=False: the search source's date only, in source_date)."""
    at = found or utcnow()
    with db.session() as s:
        n = NewsItem(company_slug=slug, run_id=run_id, source="fixture", title=title, url=url or f"https://example.com/{uuid.uuid4().hex}",
                     publisher="Sample wire", published_at=at if confirmed else None, source_date=None if confirmed else at,
                     date_status="confirmed" if confirmed else "source_only", sentiment=sentiment, found_at=at, check_status=check, **extra)
        s.add(n); s.commit()
        return n.id


def adverse(slug, title, category="regulatory", news_id=None, state="open"):
    with db.session() as s:
        a = AdverseItem(company_slug=slug, news_item_id=news_id, category=category, title=title, url=f"https://example.com/{uuid.uuid4().hex}",
                        publisher="Sample regulator", state=state)
        s.add(a); s.commit()
        return a.id


def audit(client, **params):
    r = client.get(V1 + "/audit", headers=TAO, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def notes_of(client, uid, kind=None):
    r = client.get(V1 + "/notifications", headers=H(uid))
    assert r.status_code == 200, r.text
    return [n for n in r.json() if kind is None or n["kind"] == kind]


# ---------- seed ----------
def test_seed_adds_companies_and_links_once_and_keeps_app_edits(client):
    with db.session() as s:
        assert s.scalar(select(Company).where(Company.slug == "tlfc")).name == "TLFC"
        assert sorted(d.slug for d in s.scalars(select(Deal).where(Deal.company_slug == "tlfc")).all()) == [
            "move-trust-tlfc-leases", "move-trust-tlfc-loans", "move-trust-tlfc-lp-leases"]
        assert all(d.company_slug for d in s.scalars(select(Deal)).all())          # every seeded deal is on a company
        assert len(s.scalars(select(Company)).all()) == 10
    r = client.patch(V1 + "/companies/tlfc", headers=TAO, json={"name": "TLFC Group", "industry": "Truck and trailer finance",
                                                                 "deal_slugs": ["move-trust-tlfc-leases", "move-trust-tlfc-loans", ESSEX],
                                                                 "reason": "regroup for test"})
    assert r.status_code == 200, r.text
    with db.session() as s:
        counts = seed.load(s)
        assert counts["companies_added"] == 0
        assert counts["deals_linked"] == 1                       # only lp-leases, which the edit left on no company
        again = seed.load(s)
        assert again["companies_added"] == 0 and again["deals_linked"] == 0
        co = s.get(Company, "tlfc")
        assert (co.name, co.industry) == ("TLFC Group", "Truck and trailer finance")
        assert s.get(Deal, ESSEX).company_slug == "tlfc"         # the app's re-link survives
        assert s.get(Deal, "move-trust-tlfc-lp-leases").company_slug == "tlfc"


# ---------- list and record ----------
def test_tao_list_reads_latest_publications(client, published):
    for h in (TAO, ANALYST):
        got = rows(client, h)
        assert len(got) == 10
        e = got["essex-lease-financial-corp"]
        ref = reference_deal(ESSEX)
        assert e["name"] == "Essex Lease Financial Corp." and [d["deal_slug"] for d in e["deals"]] == [ESSEX]
        assert e["deals"][0] == {"deal_slug": ESSEX, "deal_name": e["deals"][0]["deal_name"], "program_slug": "move-trust", "program_name": "MOVE Trust",
                                 "latest_period": "2026-07", "worst_status": "WATCH", "next_report": None}
        assert e["status"] == "WATCH" and (e["breach"], e["watch"]) == (0, 1)
        assert e["balance"] == pytest.approx(ref["tranche_balance"]["closing"])
        assert e["delinquency"] == {"min": 0.0131, "max": 0.0131, "direction": "up"}
        assert e["news_7d"] == 0 and e["adverse"] == {"state": "not_screened", "to_review": 0}
        assert e["notes"] == 0 and e["following"] is False and e["industry"] is None
        f = got["finloc-2000-inc"]
        assert f["status"] == "BREACH" and f["breach"] == 6 and f["delinquency"]["direction"] == "down"
        t = got["tlfc"]
        assert len(t["deals"]) == 3 and t["delinquency"]["min"] == 0.0035 and t["delinquency"]["max"] == 0.0043
        tlfc_bal = sum(reference_deal(x)["tranche_balance"]["closing"] for x in ("move-trust-tlfc-leases", "move-trust-tlfc-loans", "move-trust-tlfc-lp-leases"))
        assert t["balance"] == pytest.approx(tlfc_bal)
        m = got["moneda-capital-corp"]
        assert m["deals"][0]["latest_period"] == "2026-08" and m["delinquency"] == {"min": 0.0179, "max": 0.0179, "direction": "down"}
        assert got["meridian-onecap-lp"]["delinquency"] == {"min": None, "max": None, "direction": None}   # no ratio history


def test_company_record_and_relationship_since(client, published):
    r = client.get(V1 + "/companies/essex-lease-financial-corp", headers=TAO)
    assert r.status_code == 200
    c = r.json()
    assert c["relationship_since"] == "2018-09" and c["relationship_since_source"] == "first_vintage"
    assert c["owner"] is None and c["contacts"] == [] and c["aliases"] == ["Essex Lease Financial"] and c["updated_at"]
    assert client.get(V1 + "/companies/tlfc", headers=TAO).json()["relationship_since"] == "2016-01"            # '2016H1'
    assert client.get(V1 + "/companies/dynamic-capital", headers=TAO).json()["relationship_since"] == "2014-12"  # 'Dec-14 ‒ Nov-15'
    r = client.patch(V1 + "/companies/essex-lease-financial-corp", headers=TAO,
                     json={"relationship_since": "2015-03", "owner_user_id": AN, "industry": "Equipment leasing", "reason": "from the file"})
    c = r.json()
    assert (c["relationship_since"], c["relationship_since_source"], c["owner"]) == ("2015-03", "record", {"id": AN, "name": "J. Moreau"})
    c = client.patch(V1 + "/companies/essex-lease-financial-corp", headers=TAO, json={"relationship_since": None, "reason": "back to default"}).json()
    assert (c["relationship_since"], c["relationship_since_source"]) == ("2018-09", "first_vintage")
    assert code(client.patch(V1 + "/companies/essex-lease-financial-corp", headers=TAO, json={"owner_user_id": IA, "reason": "partner owner"})) == (422, "invalid")
    assert client.patch(V1 + "/companies/essex-lease-financial-corp", headers=TAO, json={"relationship_since": "2015-13", "reason": "bad month"}).status_code == 422
    assert code(client.patch(V1 + "/companies/essex-lease-financial-corp", headers=TAO, json={"reason": "nothing"})) == (422, "invalid")
    assert code(client.get(V1 + "/companies/nope", headers=TAO)) == (404, "not_found")


def test_create_and_relink_deals_with_audit(client, published):
    body = {"slug": "tlfc-lp", "name": "TLFC LP", "aliases": ["TLFC LP", " "], "deal_slugs": ["move-trust-tlfc-lp-leases"], "reason": "split LP out"}
    assert code(client.post(V1 + "/companies", headers=ANALYST, json=body)) == (403, "admin_only")
    r = client.post(V1 + "/companies", headers=TAO, json=body)
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["slug"] == "tlfc-lp" and c["aliases"] == ["TLFC LP"] and [d["deal_slug"] for d in c["deals"]] == ["move-trust-tlfc-lp-leases"]
    assert len(rows(client, TAO)["tlfc"]["deals"]) == 2
    assert code(client.post(V1 + "/companies", headers=TAO, json=body)) == (409, "slug_taken")
    assert code(client.post(V1 + "/companies", headers=TAO, json={**body, "slug": "x", "deal_slugs": ["nope"]})) == (422, "unknown_deal")
    assert client.post(V1 + "/companies", headers=TAO, json={**body, "slug": "Bad Slug"}).status_code == 422
    made = audit(client, scope="platform", action="company_change")
    assert {k for a in made for k in a["detail"]} == {"company_slug", "company_name", "change", "contact_id", "before", "after"}
    created = next(a for a in made if a["detail"]["change"] == "created")
    assert created["detail"]["company_name"] == "TLFC LP" and created["detail"]["before"] is None and created["detail"]["contact_id"] is None
    assert created["reason"] == "split LP out" and created["detail"]["after"]["name"] == "TLFC LP"
    links = {a["detail"]["company_slug"]: a["detail"] for a in made if a["detail"]["change"] == "deals"}
    assert links["tlfc-lp"]["before"] == {"deal_slugs": []} and links["tlfc-lp"]["after"] == {"deal_slugs": ["move-trust-tlfc-lp-leases"]}
    assert links["tlfc"]["after"] == {"deal_slugs": ["move-trust-tlfc-leases", "move-trust-tlfc-loans"]}     # the company it left
    # taking a deal away leaves it on no company: its own row, named after the deal, readable by its slug
    r = client.patch(V1 + "/companies/tlfc-lp", headers=TAO, json={"deal_slugs": [], "reason": "unlink for test"})
    assert r.status_code == 200 and r.json()["deals"] == []
    got = rows(client, TAO)
    lone = got["move-trust-tlfc-lp-leases"]
    assert lone["name"] == "TLFC LP (Leases)" and lone["adverse"]["state"] == "not_screened"
    assert lone["notes"] == 0 and [d["deal_slug"] for d in lone["deals"]] == ["move-trust-tlfc-lp-leases"]
    c = client.get(V1 + "/companies/move-trust-tlfc-lp-leases", headers=TAO).json()
    assert c["deals"][0]["deal_slug"] == "move-trust-tlfc-lp-leases" and c["owner"] is None and c["relationship_since_source"] == "first_vintage"
    assert client.get(V1 + "/companies/move-trust-tlfc-lp-leases/deals/move-trust-tlfc-lp-leases/insights", headers=TAO).status_code == 200
    assert client.get(V1 + "/companies/move-trust-tlfc-lp-leases/news", headers=TAO).json() == []
    assert code(client.post(V1 + "/companies/move-trust-tlfc-lp-leases/notes", headers=H(A1), json={"body": "x"})) == (404, "not_found")
    upd = [a for a in audit(client, scope="platform", action="company_change") if a["detail"]["change"] == "deals"]
    assert upd[0]["detail"]["before"] == {"deal_slugs": ["move-trust-tlfc-lp-leases"]} and upd[0]["detail"]["after"] == {"deal_slugs": []}
    client.patch(V1 + "/companies/tlfc-lp", headers=TAO, json={"industry": "Truck finance", "name": "TLFC LP", "reason": "fill industry"})
    rec = audit(client, scope="platform", action="company_change")[0]["detail"]
    assert (rec["change"], rec["before"], rec["after"]) == ("record", {"industry": None}, {"industry": "Truck finance"})
    assert not audit(client, scope="reports", action="company_change")


# ---------- partner gating and scope ----------
ROUTES = ["/companies", "/companies/essex-lease-financial-corp", f"/companies/essex-lease-financial-corp/deals/{ESSEX}/insights",
          "/companies/essex-lease-financial-corp/news", "/companies/essex-lease-financial-corp/adverse", "/companies/essex-lease-financial-corp/notes"]


def test_partner_roles_get_404_while_profiles_are_off(client, published):
    for h in PARTNERS:
        assert client.get(V1 + "/me", headers=h).json()["features"] == {"companies": False}
        for path in ROUTES:
            assert code(client.get(V1 + path, headers=h)) == (404, "not_found"), (h, path)
    for uid in (IA, IV, MA, MV):
        assert code(client.put(V1 + "/companies/tlfc/follow", headers=H(uid))) == (404, "not_found")
        assert code(client.post(V1 + "/companies/tlfc/notes", headers=H(uid), json={"body": "x"})) == (404, "not_found")
    for h in (TAO, ANALYST):
        assert client.get(V1 + "/me", headers=h).json()["features"] == {"companies": True}
    profiles_on(client)
    for h in PARTNERS:
        assert client.get(V1 + "/me", headers=h).json()["features"] == {"companies": True}
        for path in ROUTES[:-1]:
            assert client.get(V1 + path, headers=h).status_code == 200, (h, path)
        assert code(client.get(V1 + ROUTES[-1], headers=h)) == (403, "tao_only")


def test_partner_rows_have_no_notes_and_cross_partner_is_404(client, published):
    profiles_on(client)
    share_fpil_with_investor_only(client)
    inv, mgr = rows(client, INV), rows(client, MGR)
    assert "moneda-capital-corp" in inv and "moneda-capital-corp" not in mgr and len(mgr) == 7
    assert all("notes" not in r for r in list(inv.values()) + list(mgr.values()))
    assert inv["essex-lease-financial-corp"]["adverse"] == {"state": "not_screened", "to_review": 0}
    for path in ("/companies/moneda-capital-corp", f"/companies/moneda-capital-corp/deals/{MONEDA}/insights", "/companies/moneda-capital-corp/news",
                 "/companies/moneda-capital-corp/adverse"):
        assert code(client.get(V1 + path, headers=MGR)) == (404, "not_found"), path
        assert client.get(V1 + path, headers=INV).status_code == 200, path
    assert code(client.put(V1 + "/companies/moneda-capital-corp/follow", headers=H(MV))) == (404, "not_found")
    # a deal of another company is 404 on this company's insights
    assert code(client.get(V1 + f"/companies/tlfc/deals/{ESSEX}/insights", headers=TAO)) == (404, "not_found")
    # partners: owner hidden, contacts listed
    client.post(V1 + "/companies/essex-lease-financial-corp/contacts", headers=TAO, json={"name": "R. Singh", "role": "CFO", "reason": "add contact"})
    client.patch(V1 + "/companies/essex-lease-financial-corp", headers=TAO, json={"owner_user_id": A1, "reason": "owner"})
    c = client.get(V1 + "/companies/essex-lease-financial-corp", headers=INV).json()
    assert c["owner"] is None and [x["name"] for x in c["contacts"]] == ["R. Singh"]
    assert client.get(V1 + "/companies/essex-lease-financial-corp", headers=TAO).json()["owner"] == {"id": A1, "name": "A. Patel"}
    # partner writes
    assert code(client.post(V1 + "/companies", headers=INV_ADMIN, json={"slug": "x", "name": "x", "deal_slugs": [], "reason": "nope"})) == (403, "admin_only")
    assert code(client.patch(V1 + "/companies/tlfc", headers=INV_ADMIN, json={"name": "x", "reason": "nope"})) == (403, "admin_only")


def test_notes_are_tao_only_and_never_reach_a_partner(client, published):
    profiles_on(client)
    assert code(client.post(V1 + "/companies/essex-lease-financial-corp/notes", headers=ANALYST, json={"body": NOTE})) == (401, "user_required")
    r = client.post(V1 + "/companies/essex-lease-financial-corp/notes", headers=H(AN), json={"body": NOTE, "mentions": [A1], "collection_period": "2026-07"})
    assert r.status_code == 201, r.text
    n = r.json()
    assert n["author"] == {"id": AN, "name": "J. Moreau"} and n["mentions"] == [{"id": A1, "name": "A. Patel"}] and n["collection_period"] == "2026-07"
    assert n["edited_at"] is None
    assert code(client.post(V1 + "/companies/essex-lease-financial-corp/notes", headers=H(AN), json={"body": "x", "mentions": [IA]})) == (422, "bad_mention")
    for uid in (IA, IV, MA, MV):
        assert code(client.post(V1 + "/companies/essex-lease-financial-corp/notes", headers=H(uid), json={"body": "x"})) == (403, "tao_only")
        assert code(client.patch(V1 + f"/company-notes/{n['id']}", headers=H(uid), json={"body": "x"})) == (403, "tao_only")
        assert code(client.delete(V1 + f"/company-notes/{n['id']}", headers=H(uid))) == (403, "tao_only")
    assert rows(client, TAO)["essex-lease-financial-corp"]["notes"] == 1
    assert [x["id"] for x in client.get(V1 + "/companies/essex-lease-financial-corp/notes", headers=ANALYST).json()] == [n["id"]]
    # nothing a partner can read carries the note
    for h in PARTNERS:
        for path in ROUTES[:-1]:
            body = client.get(V1 + path, headers=h).text
            assert NOTE not in body and n["id"] not in body, (h, path)
    for uid in (IA, IV, MA, MV):
        assert NOTE not in client.get(V1 + "/notifications", headers=H(uid)).text
    # the mention
    m = notes_of(client, A1, "mention")
    assert len(m) == 1 and m[0]["link"] == f"/admin/companies/essex-lease-financial-corp?note={n['id']}" and "J. Moreau mentioned you" in m[0]["title"]
    # audit: company_note in the Platform log
    e = audit(client, scope="platform", action="company_note")
    assert len(e) == 1 and e[0]["detail"] == {"company_slug": "essex-lease-financial-corp", "note_id": n["id"], "body": NOTE, "mentions": [A1],
                                              "collection_period": "2026-07"}
    assert not audit(client, scope="reports", action="company_note")


def test_note_edit_by_author_and_removal(client, published):
    n = client.post(V1 + "/companies/tlfc/notes", headers=H(AN), json={"body": "first text"}).json()
    assert code(client.patch(V1 + f"/company-notes/{n['id']}", headers=H(A1), json={"body": "hijack"})) == (403, "not_author")
    r = client.patch(V1 + f"/company-notes/{n['id']}", headers=H(AN), json={"body": "second text", "mentions": [A2]})
    assert r.status_code == 200 and r.json()["body"] == "second text" and r.json()["edited_at"]
    assert len(notes_of(client, A2, "mention")) == 1
    other = client.post(V1 + "/companies/tlfc/notes", headers=H(A1), json={"body": "admin note"}).json()
    assert code(client.delete(V1 + f"/company-notes/{other['id']}", headers=H(AN))) == (403, "forbidden")
    assert client.delete(V1 + f"/company-notes/{n['id']}", headers=H(A2)).status_code == 204          # any tao_admin
    assert client.delete(V1 + f"/company-notes/{other['id']}", headers=H(A1)).status_code == 204      # the author
    assert code(client.patch(V1 + f"/company-notes/{n['id']}", headers=H(AN), json={"body": "again"})) == (404, "not_found")
    assert client.get(V1 + "/companies/tlfc/notes", headers=TAO).json() == []
    edits = audit(client, scope="platform", action="company_note_edit")
    assert set(edits[0]["detail"]) == {"company_slug", "note_id", "change", "before", "after"}
    assert [e["detail"]["change"] for e in edits] == ["removed", "removed", "edited"]
    assert edits[-1]["detail"]["before"]["body"] == "first text" and edits[-1]["detail"]["after"]["body"] == "second text"
    assert edits[1]["detail"]["before"]["body"] == "second text" and edits[1]["detail"]["after"] is None
    with db.session() as s:
        assert len(s.scalars(select(CompanyNote)).all()) == 2                     # rows are kept


def test_contacts_admin_only_and_audited(client, published):
    body = {"name": "L. Martin", "role": "Servicing manager", "email": "l.martin@example.com", "receives": "Monthly SetRep", "reason": "new contact"}
    assert code(client.post(V1 + "/companies/tlfc/contacts", headers=ANALYST, json=body)) == (403, "admin_only")
    r = client.post(V1 + "/companies/tlfc/contacts", headers=TAO, json=body)
    assert r.status_code == 201
    x = r.json()
    assert {k: x[k] for k in ("name", "role", "email", "receives")} == {k: body[k] for k in ("name", "role", "email", "receives")}
    assert code(client.patch(V1 + f"/company-contacts/{x['id']}", headers=ANALYST, json={"name": "y", "reason": "nope"})) == (403, "admin_only")
    r = client.patch(V1 + f"/company-contacts/{x['id']}", headers=TAO, json={"name": "L. Martin", "receives": None, "reason": "no longer"})
    assert r.json()["receives"] is None and r.json()["role"] == "Servicing manager"
    assert client.delete(V1 + f"/company-contacts/{x['id']}", headers=TAO).status_code == 422          # reason required
    assert client.delete(V1 + f"/company-contacts/{x['id']}", headers=TAO, params={"reason": "left the company"}).status_code == 204
    assert client.get(V1 + "/companies/tlfc", headers=TAO).json()["contacts"] == []
    assert code(client.delete(V1 + f"/company-contacts/{x['id']}", headers=TAO, params={"reason": "again"})) == (404, "not_found")
    changes = [a["detail"]["change"] for a in audit(client, scope="platform", action="company_change")]
    assert changes == ["contact_removed", "contact_edited", "contact_added"]
    assert {a["detail"]["contact_id"] for a in audit(client, scope="platform", action="company_change")} == {x["id"]}


def test_follow_and_following_filter(client, published):
    assert code(client.put(V1 + "/companies/tlfc/follow", headers=TAO)) == (401, "user_required")
    assert client.put(V1 + "/companies/tlfc/follow", headers=H(AN)).status_code == 204
    assert client.put(V1 + "/companies/tlfc/follow", headers=H(AN)).status_code == 204                 # idempotent
    assert list(rows(client, H(AN), following=True)) == ["tlfc"]
    assert rows(client, H(AN))["tlfc"]["following"] is True and rows(client, H(A1))["tlfc"]["following"] is False
    assert client.get(V1 + "/companies/tlfc", headers=H(AN)).json()["following"] is True
    assert client.delete(V1 + "/companies/tlfc/follow", headers=H(AN)).status_code == 204
    assert rows(client, H(AN), following=True) == {}
    profiles_on(client)
    assert client.put(V1 + "/companies/tlfc/follow", headers=H(IV)).status_code == 204
    assert list(rows(client, H(IV), following=True)) == ["tlfc"]


# ---------- news and adverse ----------
def test_news_and_adverse_reads_and_screening_state(client, published):
    profiles_on(client)
    nid = news("essex-lease-financial-corp", "Essex Lease Financial names new CFO", "positive")
    news("essex-lease-financial-corp", "Older item", "neutral", found=utcnow() - dt.timedelta(days=40))
    neg = news("essex-lease-financial-corp", "Essex Lease Financial faces claim", "negative")
    a_open = adverse("essex-lease-financial-corp", "Regulator notice names Essex", "regulatory", neg)
    a_rev = adverse("essex-lease-financial-corp", "Claim filed", "litigation", neg)
    a_dis = adverse("essex-lease-financial-corp", "Similar name insolvency", "insolvency")
    e = rows(client, TAO)["essex-lease-financial-corp"]
    assert e["news_7d"] == 0 and e["adverse"]["state"] == "not_screened"           # no finished run yet
    finished_run("running")
    assert rows(client, TAO)["essex-lease-financial-corp"]["adverse"]["state"] == "not_screened"
    finished_run("partial")
    e = rows(client, TAO)["essex-lease-financial-corp"]
    assert e["news_7d"] == 2 and e["adverse"] == {"state": "to_review", "to_review": 3}
    assert rows(client, INV)["essex-lease-financial-corp"]["adverse"] == {"state": "clear", "to_review": 0}
    assert rows(client, TAO)["tlfc"]["adverse"] == {"state": "clear", "to_review": 0}
    items = client.get(V1 + "/companies/essex-lease-financial-corp/news", headers=INV).json()
    assert [x["sentiment"] for x in items] == ["negative", "positive"] and items[1]["id"] == nid and items[0]["source"] == "fixture"
    assert len(client.get(V1 + "/companies/essex-lease-financial-corp/news", headers=TAO, params={"days": 60}).json()) == 3
    assert [x["title"] for x in client.get(V1 + "/companies/essex-lease-financial-corp/news", headers=TAO, params={"sentiment": "negative"}).json()] == [
        "Essex Lease Financial faces claim"]
    assert client.get(V1 + "/companies/essex-lease-financial-corp/news", headers=TAO, params={"days": 0}).status_code == 422
    # review and dismiss
    note = {"note": "Confirmed: same entity, no action needed."}
    assert code(client.post(V1 + f"/adverse/{a_rev}/review", headers=ANALYST, json=note)) == (403, "admin_only")
    assert code(client.post(V1 + f"/adverse/{a_rev}/review", headers=INV_ADMIN, json=note)) == (403, "admin_only")
    r = client.post(V1 + f"/adverse/{a_rev}/review", headers=H(A1), json=note)
    assert r.status_code == 200 and r.json()["state"] == "reviewed" and r.json()["state_by"] == {"id": A1, "name": "A. Patel"} and r.json()["state_at"]
    assert code(client.post(V1 + f"/adverse/{a_rev}/dismiss", headers=TAO, json=note)) == (409, "bad_state")
    r = client.post(V1 + f"/adverse/{a_dis}/dismiss", headers=TAO, json={"note": "Different entity: registry number differs"})
    assert r.json()["state"] == "dismissed" and r.json()["state_by"] is None                     # demo mode: no user
    assert code(client.post(V1 + f"/adverse/{uuid.uuid4()}/review", headers=TAO, json=note)) == (404, "not_found")
    assert client.post(V1 + f"/adverse/{a_open}/review", headers=TAO, json={"note": "x"}).status_code == 422
    tao_items = client.get(V1 + "/companies/essex-lease-financial-corp/adverse", headers=ANALYST).json()
    assert sorted(x["state"] for x in tao_items) == ["dismissed", "open", "reviewed"]
    assert [x["id"] for x in client.get(V1 + "/companies/essex-lease-financial-corp/adverse", headers=TAO, params={"state": "open"}).json()] == [a_open]
    for h in PARTNERS:
        got = client.get(V1 + "/companies/essex-lease-financial-corp/adverse", headers=h).json()
        assert [x["id"] for x in got] == [a_rev] and got[0]["note"] == note["note"]
        assert client.get(V1 + "/companies/essex-lease-financial-corp/adverse", headers=h, params={"state": "open"}).json() == []
    assert rows(client, TAO)["essex-lease-financial-corp"]["adverse"] == {"state": "to_review", "to_review": 1}
    entries = audit(client, scope="platform", action="adverse_change")
    assert [(x["detail"]["state"], x["detail"]["adverse_id"]) for x in entries] == [("dismissed", a_dis), ("reviewed", a_rev)]
    assert set(entries[0]["detail"]) == {"company_slug", "adverse_id", "category", "title", "state", "note"}
    assert entries[1]["reason"] == note["note"]


def test_screened_only_by_a_run_after_the_company_was_created(client, published):
    finished_run("ok", at=utcnow() - dt.timedelta(hours=1))                # before the seed created the companies
    finished_run("failed")
    assert rows(client, TAO)["tlfc"]["adverse"]["state"] == "not_screened"
    finished_run("ok")
    assert rows(client, TAO)["tlfc"]["adverse"]["state"] == "clear"
    client.post(V1 + "/companies", headers=TAO, json={"slug": "brand-new", "name": "Brand New", "deal_slugs": [], "reason": "new company"})
    assert rows(client, TAO)["brand-new"]["adverse"]["state"] == "not_screened"
    assert rows(client, TAO)["brand-new"]["deals"] == [] and rows(client, TAO)["brand-new"]["status"] is None


# ---------- news runs ----------
def test_run_now(client, news_queue):
    assert code(client.post(V1 + "/news/runs", headers=TAO)) == (409, "feeds_off")
    feeds = setting(client, "company_feeds", {"enabled": True})
    assert feeds == {"enabled": True, "run_at": "06:00", "time_zone": "America/Toronto", "sources": ["google_news", "gdelt"], "daily_cap": 200}
    assert code(client.post(V1 + "/news/runs", headers=ANALYST)) == (403, "admin_only")
    r = client.post(V1 + "/news/runs", headers=H(A1))
    assert r.status_code == 202, r.text
    run = r.json()
    assert (run["trigger"], run["status"], run["companies"], run["errors"]) == ("manual", "queued", 0, [])
    assert news_queue.jobs == [run["id"]]
    assert code(client.post(V1 + "/news/runs", headers=TAO)) == (409, "run_active")
    with db.session() as s:
        s.get(NewsRun, run["id"]).status = "running"; s.commit()
    assert code(client.post(V1 + "/news/runs", headers=TAO)) == (409, "run_active")
    with db.session() as s:
        s.get(NewsRun, run["id"]).status = "ok"; s.commit()
    assert client.post(V1 + "/news/runs", headers=TAO).status_code == 202
    listed = client.get(V1 + "/news/runs", headers=ANALYST).json()
    assert len(listed) == 2 and listed[1]["id"] == run["id"]
    assert len(client.get(V1 + "/news/runs", headers=TAO, params={"limit": 1}).json()) == 1
    assert code(client.get(V1 + "/news/runs", headers=INV)) == (403, "tao_only")
    e = audit(client, scope="platform", action="news_run")
    assert len(e) == 2 and e[1]["detail"] == {"run_id": run["id"], "trigger": "manual"} and e[1]["actor_user_id"] == A1


def test_run_now_for_one_company_works_while_feeds_are_off(client, news_queue):
    """Run now on a company profile: tao_admin only, that company only, allowed while the daily search is off."""
    assert code(client.post(V1 + "/news/runs", headers=TAO)) == (409, "feeds_off")
    assert code(client.post(V1 + "/news/runs", headers=ANALYST, params={"company_slug": "stride-capital"})) == (403, "admin_only")
    assert code(client.post(V1 + "/news/runs", headers=INV, params={"company_slug": "stride-capital"}))[0] == 403
    assert code(client.post(V1 + "/news/runs", headers=TAO, params={"company_slug": "no-such-company"})) == (404, "not_found")
    assert news_queue.jobs == []
    r = client.post(V1 + "/news/runs", headers=H(A1), params={"company_slug": "stride-capital"})
    assert r.status_code == 202, r.text
    run = r.json()
    assert (run["trigger"], run["status"], run["company_slug"]) == ("manual", "queued", "stride-capital")
    assert news_queue.jobs == [run["id"]]
    assert code(client.post(V1 + "/news/runs", headers=TAO, params={"company_slug": "moneda-capital-corp"})) == (409, "run_active")
    listed = client.get(V1 + "/news/runs", headers=TAO).json()
    assert listed[0]["company_slug"] == "stride-capital"
    e = audit(client, scope="platform", action="news_run")
    assert e[0]["detail"] == {"run_id": run["id"], "trigger": "manual", "company_slug": "stride-capital", "company_name": "Stride Capital"}


def test_run_now_queue_down_marks_the_run_failed(client):
    class Down:
        def push(self, _):
            raise ConnectionError("redis unreachable")
    app.dependency_overrides[jobs.get_news_queue] = lambda: Down()
    try:
        setting(client, "company_feeds", {"enabled": True})
        r = client.post(V1 + "/news/runs", headers=TAO)
        assert r.status_code == 202 and r.json()["status"] == "failed" and r.json()["errors"][0]["source"] == "api"
        assert client.post(V1 + "/news/runs", headers=TAO).status_code == 202                        # not stuck in run_active
    finally:
        app.dependency_overrides.pop(jobs.get_news_queue, None)


def test_news_queue_lpushes_the_id_to_its_own_list(monkeypatch):
    calls = []

    class FakeRedis:
        def lpush(self, name, value):
            calls.append((name, value))
    import redis
    monkeypatch.setattr(redis.Redis, "from_url", staticmethod(lambda *a, **k: FakeRedis()))
    monkeypatch.delenv("NEWS_QUEUE", raising=False)
    jobs.NewsQueue().push("abc")
    monkeypatch.setenv("NEWS_QUEUE", "news-test")
    jobs.NewsQueue().push("def")
    assert calls == [("news", "abc"), ("news-test", "def")] and jobs.QUEUE != "news"


# ---------- settings ----------
def test_company_settings(client):
    got = {x["key"]: x for x in client.get(V1 + "/settings", headers=TAO).json()}
    assert got["company_feeds"]["value"] == {"enabled": False, "run_at": "06:00", "time_zone": "America/Toronto", "sources": ["google_news", "gdelt"], "daily_cap": 200}
    assert got["company_profiles_partner_enabled"]["value"] is False
    bad = [{"enabled": "yes"}, {"run_at": "6:00"}, {"run_at": "24:00"}, {"time_zone": "Mars/Base"}, {"sources": ["bing"]}, {"sources": "gdelt"},
           {"sources": ["gdelt", "gdelt"]}, {"extra": 1}, [], "on"]
    for v in bad:
        assert code(client.put(V1 + "/settings/company_feeds", headers=TAO, json={"value": v, "reason": "bad value"})) == (422, "invalid"), v
    assert setting(client, "company_feeds", {"run_at": "07:30", "sources": ["gdelt"]}) == {
        "enabled": False, "run_at": "07:30", "time_zone": "America/Toronto", "sources": ["gdelt"], "daily_cap": 200}
    assert setting(client, "company_feeds", {"time_zone": "Europe/London"})["run_at"] == "07:30"                    # others kept
    assert code(client.put(V1 + "/settings/company_profiles_partner_enabled", headers=TAO, json={"value": "true", "reason": "bad"})) == (422, "invalid")
    assert setting(client, "company_profiles_partner_enabled", True) is True
    assert code(client.put(V1 + "/settings/company_profiles_partner_enabled", headers=ANALYST, json={"value": False, "reason": "x"}))[0] == 403


def test_a_placeholder_company_feeds_row_reads_over_the_defaults(client):
    from app.models import SystemSetting
    with db.session() as s:
        s.add(SystemSetting(key="company_feeds", value={}, updated_by="tao_admin")); s.commit()
    got = {x["key"]: x for x in client.get(V1 + "/settings", headers=TAO).json()}
    assert got["company_feeds"]["value"]["sources"] == ["google_news", "gdelt"]


# ---------- next report ----------
def test_next_report_fpil_same_month_and_move_following_month(client, published, monkeypatch):
    setting(client, "reporting_calendar", {MONEDA: 7, ESSEX: 31})
    monkeypatch.setattr(companies, "today", lambda: dt.date(2026, 9, 10))     # Thursday
    m = rows(client, TAO)["moneda-capital-corp"]["deals"][0]["next_report"]
    # F-PIL 2.0: 2026-08 settled 7 Aug 2026 (same month), so 2026-09 settles in September
    assert m == {"period": "2026-09", "due_on": "2026-09-07", "late": False, "business_days_late": 3}
    e = rows(client, TAO)["essex-lease-financial-corp"]["deals"][0]["next_report"]
    # MOVE Trust: 2026-07 settled 24 Aug 2026 (following month), so 2026-08 settles in September; day 31 clamps to 30
    assert e == {"period": "2026-08", "due_on": "2026-09-30", "late": False, "business_days_late": 0}
    monkeypatch.setattr(companies, "today", lambda: dt.date(2026, 9, 14))     # Monday: 5 business days after Mon 7 Sep
    m = rows(client, TAO)["moneda-capital-corp"]["deals"][0]["next_report"]
    assert m["late"] is True and m["business_days_late"] == 5
    ins = client.get(V1 + f"/companies/moneda-capital-corp/deals/{MONEDA}/insights", headers=TAO).json()
    assert any(x["kind"] == "report_late" for x in ins["signals"])
    with db.session() as s:                                                     # an upload of that period: not late
        s.add(SetrepUpload(deal_slug=MONEDA, collection_period="2026-09", file_name="x.pdf", file_path="", uploaded_by="tao_admin", status="received"))
        s.commit()
    assert rows(client, TAO)["moneda-capital-corp"]["deals"][0]["next_report"] == {"period": "2026-09", "due_on": "2026-09-07", "late": False,
                                                                                     "business_days_late": 0}
    assert rows(client, TAO)["tlfc"]["deals"][0]["next_report"] is None          # no expected day


# ---------- insights ----------
def _ref_all():
    out = {}
    for f in sorted(REF.glob("*.dashboard.json")):
        if not f.name.startswith("program-"):
            d = json.loads(f.read_text(encoding="utf-8"))
            out[d["deal_slug"]] = d
    return out


def test_insights_essex_against_reference(client, published):
    r = client.get(V1 + f"/companies/essex-lease-financial-corp/deals/{ESSEX}/insights", headers=TAO)
    assert r.status_code == 200, r.text
    ins = r.json()
    assert ins["deal_slug"] == ESSEX and ins["collection_period"] == "2026-07"
    s = {x["metric"]: x for x in ins["series"]}
    assert set(s) == {"delinquency_ratio_pct", "rolling_3month_loss_ratio_pct", "rolling_12month_loss_ratio_pct", "interest_coverage_ratio",
                      "debt_equity_ratio", "total_equity"}
    d = s["delinquency_ratio_pct"]
    assert [p["month"] for p in d["deal"]][0] == "2025-07" and len(d["deal"]) == 13
    assert d["deal"][-1] == {"month": "2026-07", "value": 0.0131} and d["unit"] == "fraction"
    assert d["limit"] == {"legal_ref": "MSA 8.1 (d)", "threshold": 0.035, "kind": "ceiling"}
    # MOVE Trust median for July 2026: one point per other company reporting it (D3); TLFC's three deals count once,
    # at the median of their values
    refs = _ref_all()
    company = {d["deal_slugs"][i]: d["slug"] for d in json.loads((REF.parents[1] / "seed" / "companies.json").read_text(encoding="utf-8"))
               for i in range(len(d["deal_slugs"]))}
    by = {}
    for k, x in refs.items():
        if k.startswith("move-trust") and k != ESSEX:
            for r in x["ratio_history"]:
                if r["month"] == "Jul-26" and r.get("delinquency_ratio_pct") is not None:
                    by.setdefault(company[k], []).append(r["delinquency_ratio_pct"])
    others = [statistics.median(v) for v in by.values()]
    assert len(by["tlfc"]) == 3 and len(others) == 5
    jul = d["program_median"][-1]
    assert jul == {"month": "2026-07", "value": pytest.approx(statistics.median(others))} and jul["value"] == pytest.approx(0.0042)
    assert d["program_mean"][-1]["value"] == pytest.approx(sum(others) / len(others))
    assert d["peers_in_month"][-1] == {"month": "2026-07", "count": 5}
    assert s["interest_coverage_ratio"]["limit"] == {"legal_ref": "MSA 8.1 (h)", "threshold": 1.0, "kind": "floor"}
    assert s["total_equity"]["unit"] == "currency" and s["interest_coverage_ratio"]["unit"] == "ratio"
    kinds = {x["kind"] for x in ins["signals"]}
    assert {"covenant_near_limit", "rising_3m", "obligor_near_limit", "utilization_high", "restated", "losses_high"} <= kinds
    assert next(x for x in ins["signals"] if x["kind"] == "rising_3m" and x["anchor"] == "chart-delinquency_ratio_pct")["severity"] == "rising"
    near = next(x for x in ins["signals"] if x["kind"] == "covenant_near_limit")
    assert near["anchor"] == "chart-interest_coverage_ratio" and "MSA 8.1 (h)" in near["title"]
    assert "report_late" not in kinds
    # loss peers: same program, same rolling field; TPine's rolling ratios run far past Essex's, so listed, not drawn
    lp = {(x["deal_slug"], x["metric"]): x for x in ins["loss_peers"]}
    assert {k[0] for k in lp} == {"move-trust-dynamic-capital", "move-trust-tpine-leasing-capital-corporation"}
    assert lp[("move-trust-tpine-leasing-capital-corporation", "rolling_3month_loss_ratio_pct")]["drawn"] is False
    assert lp[("move-trust-dynamic-capital", "rolling_3month_loss_ratio_pct")]["drawn"] is True
    # covenant history: July 2026 published. MOVE Trust has no covenant definitions in master data, so no definition is in
    # force for earlier months and nothing is recomputed (F-PIL 2.0 below)
    ch = {(x["legal_ref"], x["description"]): x for x in ins["covenant_history"]}
    dq = next(v for k, v in ch.items() if k[0] == "MSA 8.1 (d)")
    assert dq["cells"][-1] == {"month": "2026-07", "status": "OK", "source": "published"} and len(dq["cells"]) == 13
    assert all(c == {"month": c["month"], "status": None, "source": None} for c in dq["cells"][:-1])
    icr = next(v for k, v in ch.items() if k[0] == "MSA 8.1 (h)")
    assert icr["cells"][-1]["status"] == "WATCH"
    binary = next(v for k, v in ch.items() if k[0] == "MSA 8.1 (c)")
    assert binary["cells"][-1]["source"] == "published" and all(c["status"] is None for c in binary["cells"][:-1])
    # restatements: the company's own plus TAO corrections
    rs = ins["restatements"]
    icr_r = next(x for x in rs if x["field"] == "interest_coverage_ratio")
    assert icr_r == {"month": "2026-04", "field": "interest_coverage_ratio", "first_reported": 1.15, "now": 1.12, "changed_in": "2026-05",
                     "type": "restated_by_company"}
    corr = next(x for x in rs if x["type"] == "tao_correction")
    assert corr == {"month": "2026-07", "field": "period_history.interest", "first_reported": 1290661.69, "now": pytest.approx(1371370.08),
                    "changed_in": "2026-10-09", "type": "tao_correction"}
    assert len(ins["balance_median_change"]) == 4 and ins["balance_median_change"][-1]["month"] == "2026-07"
    # a TLFC deal: its sister deals are its own company, so they are left out of the program line
    tl = client.get(V1 + "/companies/tlfc/deals/move-trust-tlfc-leases/insights", headers=TAO).json()
    tld = next(x for x in tl["series"] if x["metric"] == "delinquency_ratio_pct")
    assert tld["peers_in_month"][-1] == {"month": "2026-07", "count": 5}                 # Dynamic, Essex, Finloc, TPine, VCC
    assert tld["program_median"][-1]["value"] == pytest.approx(statistics.median([0.0019, 0.0131, 0.0883, 0.0214, 0.0042]))


def test_insights_fpil_ratio_month_and_partner_view(client, published):
    profiles_on(client)
    ins = client.get(V1 + f"/companies/moneda-capital-corp/deals/{MONEDA}/insights", headers=MGR).json()
    assert ins["collection_period"] == "2026-08"
    d = next(x for x in ins["series"] if x["metric"] == "delinquency_ratio_pct")
    assert d["deal"][-1] == {"month": "2026-07", "value": 0.0179}
    vals = [0.0233, 0.0055]                                                     # Stride and Xpedite, Jul-26
    assert d["program_median"][-1]["value"] == pytest.approx(statistics.median(vals)) and d["peers_in_month"][-1]["count"] == 2
    ch = next(x for x in ins["covenant_history"] if x["legal_ref"] == "SLFA 9.1 (f)")
    assert ch["cells"][-1] == {"month": "2026-07", "status": "WATCH", "source": "published"}   # the 2026-08 report's month
    # recomputed with the definitions in force: Moneda's from 2022-12 (ICR from 2023-12), threshold_rule resolved
    dq = next(x for x in ins["covenant_history"] if x["legal_ref"] == "SLFA 9.1 (e)")
    assert [c["source"] for c in dq["cells"]] == ["recomputed"] * 12 + ["published"]
    dl = {companies.month_key(r["month"]): r["delinquency_ratio_pct"] for r in reference_deal(MONEDA)["ratio_history"]}
    for c in dq["cells"][:-1]:                                                # ceiling 3.5%, watch from 3.5% x 0.9
        assert c["status"] == ("BREACH" if dl[c["month"]] > 0.035 else "WATCH" if dl[c["month"]] >= 0.0315 - 1e-9 else "OK"), c
    assert "WATCH" in {c["status"] for c in dq["cells"]}
    icr = next(x for x in ins["covenant_history"] if x["legal_ref"] == "SLFA 9.1 (h)")
    rh = {companies.month_key(r["month"]): r["interest_coverage_ratio"] for r in reference_deal(MONEDA)["ratio_history"]}
    for c in icr["cells"][:-1]:                                               # floor 1.1, watch at or under 1.1 / 0.9
        assert c["status"] == ("BREACH" if rh[c["month"]] < 1.1 else "WATCH" if rh[c["month"]] <= 1.1 / 0.9 + 1e-9 else "OK"), c
    # Stride's definitions start 2026-01-22: nothing recomputed for the months before
    st = client.get(V1 + "/companies/stride-capital/deals/f-pil-2-0-stride-capital/insights", headers=TAO).json()
    dl = next(x for x in st["covenant_history"] if x["legal_ref"] == "SLFA 9.1(f)")
    assert [c["month"] for c in dl["cells"]][0] == "2025-07" and [c["source"] for c in dl["cells"][:6]] == [None] * 6
    assert [c["source"] for c in dl["cells"][6:]] == ["recomputed"] * 6 + ["published"]
    # Meridian has no ratio history: no series, 13 months of covenant history ending at its report month
    mer = client.get(V1 + "/companies/meridian-onecap-lp/deals/move-trust-meridian-onecap-lp/insights", headers=TAO).json()
    assert mer["series"] == [] and mer["covenant_history"][0]["cells"][-1] == {"month": "2026-07", "status": "OK", "source": "published"}
    assert len(mer["covenant_history"][0]["cells"]) == 13


def test_insights_404_when_never_published(client):
    assert code(client.get(V1 + f"/companies/essex-lease-financial-corp/deals/{ESSEX}/insights", headers=TAO)) == (404, "not_found")
    e = rows(client, TAO)["essex-lease-financial-corp"]
    assert e["deals"][0]["latest_period"] is None and e["status"] is None and e["balance"] is None


# ---------- notifications ----------
def test_adverse_and_negative_news_notifications_and_gating(client, published):
    for uid, h in ((AN, H(AN)),):
        assert client.put(V1 + "/companies/essex-lease-financial-corp/follow", headers=h).status_code == 204
    profiles_on(client)
    for uid in (IV, MV):
        assert client.put(V1 + "/companies/essex-lease-financial-corp/follow", headers=H(uid)).status_code == 204
    neg = news("essex-lease-financial-corp", "Essex Lease Financial faces claim", "negative")
    news("essex-lease-financial-corp", "Essex Lease Financial wins award", "positive")
    a1 = adverse("essex-lease-financial-corp", "Regulator notice names Essex", "regulatory", neg)
    a2 = adverse("essex-lease-financial-corp", "Claim filed against Essex", "litigation", neg)
    got = notes_of(client, AN)
    assert sorted(n["kind"] for n in got) == ["adverse_media", "adverse_media", "negative_news"]
    assert all(n["link"] == "/admin/companies/essex-lease-financial-corp" for n in got)
    assert notes_of(client, AN) == got                                          # sent once
    assert notes_of(client, A1) == []                                           # not following
    # partners: nothing while partner notifications are off, and never open items
    for uid in (IV, MV):
        assert notes_of(client, uid, "adverse_media") == [] and notes_of(client, uid, "negative_news") == []
    setting(client, "partner_notifications_enabled", True)
    client.post(V1 + f"/adverse/{a1}/review", headers=TAO, json={"note": "Confirmed, monitoring."})
    for uid, base in ((IV, "/investor"), (MV, "/manager")):
        got = notes_of(client, uid, "adverse_media")
        assert len(got) == 1 and got[0]["link"] == f"{base}/companies/essex-lease-financial-corp" and "reviewed" in got[0]["title"]
        assert notes_of(client, uid, "negative_news") == []                     # that item went out while partners were off
    neg2 = news("essex-lease-financial-corp", "Essex Lease Financial downgrade", "negative")
    assert len(notes_of(client, IV, "negative_news")) == 1 and len(notes_of(client, AN, "negative_news")) == 2
    client.post(V1 + f"/adverse/{a2}/dismiss", headers=TAO, json={"note": "Different entity"})
    assert len(notes_of(client, IV, "adverse_media")) == 1                      # dismissed never reaches a partner
    # profiles off: partner alerts go quiet (hidden on read) and no new ones are made
    profiles_on(client, False)
    assert notes_of(client, IV, "adverse_media") == [] and notes_of(client, IV, "negative_news") == []
    a3 = adverse("essex-lease-financial-corp", "Fraud allegation", "fraud")
    client.post(V1 + f"/adverse/{a3}/review", headers=TAO, json={"note": "Reviewed."})
    profiles_on(client)
    assert len(notes_of(client, IV, "adverse_media")) == 1
    # a partner who cannot see the company gets nothing; a switched-off kind is not created
    share_fpil_with_investor_only(client)
    assert client.put(V1 + "/companies/moneda-capital-corp/follow", headers=H(IV)).status_code == 204
    client.put(V1 + "/settings/company_profiles_partner_enabled", headers=TAO, json={"value": True, "reason": "x"})
    prefs = [{"kind": "negative_news", "in_app": False, "digest": "instant"}]
    assert client.put(V1 + "/me/notification-prefs", headers=H(AN), json=prefs).status_code == 200
    news("essex-lease-financial-corp", "Essex Lease Financial loss", "negative")
    assert len(notes_of(client, AN, "negative_news")) == 2
    assert len(notes_of(client, IV, "negative_news")) == 2
    tabs = client.get(V1 + "/notifications/unread-count", headers=H(AN)).json()
    assert tabs["reports"] >= 3


def test_partner_prefs_include_company_kinds(client):
    kinds = [p["kind"] for p in client.get(V1 + "/me/notification-prefs", headers=H(IV)).json()]
    assert "adverse_media" in kinds and "negative_news" in kinds and "report_late" not in kinds
    tao = [p["kind"] for p in client.get(V1 + "/me/notification-prefs", headers=H(AN)).json()]
    assert {"adverse_media", "negative_news", "report_late"} <= set(tao)
    assert code(client.put(V1 + "/me/notification-prefs", headers=H(IV), json=[{"kind": "report_late", "in_app": True, "digest": "instant"}])) == (422, "invalid")


def test_report_late_once_per_deal_and_period_to_subscribed_tao(client, published, monkeypatch):
    setting(client, "reporting_calendar", {MONEDA: 7})
    assert client.put(V1 + f"/users/{AN}/subscriptions", headers=TAO, json=[{"program_slug": "f-pil-2-0", "deal_slug": None, "channels": ["in_app"]}]).status_code == 200
    assert client.put(V1 + f"/users/{IV}/subscriptions", headers=TAO, json=[{"program_slug": "f-pil-2-0", "deal_slug": None, "channels": ["in_app"]}]).status_code == 200
    setting(client, "partner_notifications_enabled", True)
    monkeypatch.setattr(companies, "today", lambda: dt.date(2026, 9, 11))
    assert notes_of(client, AN, "report_late") == []
    monkeypatch.setattr(companies, "today", lambda: dt.date(2026, 9, 14))
    got = notes_of(client, AN, "report_late")
    assert len(got) == 1 and got[0]["deal_slug"] == MONEDA and got[0]["collection_period"] == "2026-09"
    assert got[0]["link"] == "/admin/companies/moneda-capital-corp" and "September 2026" in got[0]["title"]
    assert len(notes_of(client, AN, "report_late")) == 1
    assert notes_of(client, IV, "report_late") == [] and notes_of(client, A1, "report_late") == []      # TAO only; A1 not subscribed


def test_older_stories_from_a_first_search_are_listed_not_counted_or_alerted(client, published):
    """Lead, wave D live check: a company's first search keeps up to 90 days of stories. They are found today but happened
    earlier, so news_7d, the default 30-day list and negative_news go by published_at (found_at only when it is missing)."""
    assert client.put(V1 + "/companies/essex-lease-financial-corp/follow", headers=H(A1)).status_code == 204
    finished_run("ok")
    with db.session() as s:
        s.add(NewsItem(company_slug="essex-lease-financial-corp", source="fixture", title="Essex Lease Financial faces older claim",
                       url="https://example.com/old-claim", publisher="Sample wire", published_at=utcnow() - dt.timedelta(days=60),
                       sentiment="negative", found_at=utcnow()))
        s.commit()
    assert rows(client, TAO)["essex-lease-financial-corp"]["news_7d"] == 0
    assert client.get(V1 + "/companies/essex-lease-financial-corp/news", headers=TAO).json() == []
    assert len(client.get(V1 + "/companies/essex-lease-financial-corp/news", headers=TAO, params={"days": 90}).json()) == 1
    assert notes_of(client, A1, "negative_news") == []
    recent = news("essex-lease-financial-corp", "Essex Lease Financial faces new claim", "negative")
    assert rows(client, TAO)["essex-lease-financial-corp"]["news_7d"] == 1
    assert [n["title"] for n in notes_of(client, A1, "negative_news")] == ["Negative news: Essex Lease Financial Corp."] and recent
