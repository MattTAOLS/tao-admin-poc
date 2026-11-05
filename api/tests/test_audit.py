"""Audit split (phase 2 wave A): scope derived from the action, Toronto calendar months, search, paging, roles,
/audit/months and /audit/export.csv."""
import csv, datetime as dt, io
import pytest
from conftest import TAO, ANALYST, INV, MGR
from test_uploads import upload, DEAL
from app import db
from app.models import ReviewAction, new_id

A = "/api/v1/audit"
UTC = dt.timezone.utc


def add(action, at, upload_id=None, reason=None, detail=None, role="tao_admin", label=None):
    with db.session() as s:
        s.add(ReviewAction(id=new_id(), upload_id=upload_id, actor_role=role, actor_label=label or role, action=action,
                           reason=reason, detail=detail or {}, at=at))
        s.commit()


@pytest.fixture
def log(client):
    """A small known log. Times in UTC; Toronto is UTC-4 until 1 Nov 2026 02:00, then UTC-5."""
    with db.engine().begin() as c:
        c.execute(ReviewAction.__table__.delete())
    uid = upload(client).json()["id"]
    with db.engine().begin() as c:                            # drop the upload's own entry; times below are the whole log
        c.execute(ReviewAction.__table__.delete())
    add("upload", dt.datetime(2026, 10, 15, 12, 0, tzinfo=UTC), upload_id=uid, detail={"file_name": "Moneda-202609 -SETTREP.pdf"})
    add("extract", dt.datetime(2026, 11, 1, 3, 30, tzinfo=UTC), upload_id=uid, role="system", reason="cover block not found")  # 31 Oct 23:30 EDT
    add("override", dt.datetime(2026, 11, 1, 4, 0, tzinfo=UTC), upload_id=uid, reason="servicer re-issued", detail={"rule_id": "R12"})  # 1 Nov 00:00 EDT
    add("publish", dt.datetime(2026, 11, 2, 15, 0, tzinfo=UTC), upload_id=uid, detail={"deal_slug": DEAL, "collection_period": "2026-09"})
    add("regenerate", dt.datetime(2026, 11, 3, 15, 0, tzinfo=UTC), detail={"program_slug": "f-pil-2-0", "trigger": "manual"})
    add("master_change", dt.datetime(2026, 10, 31, 3, 59, tzinfo=UTC), detail={"entity": "deal", "key": "essex-lease", "before": None, "after": {"name": "Essex Lease Financial Corp."}})  # 30 Oct 23:59 EDT
    add("master_change", dt.datetime(2026, 12, 1, 4, 59, tzinfo=UTC), detail={"entity": "program", "key": "move-trust"})   # 30 Nov 23:59 EST
    add("master_change", dt.datetime(2026, 12, 1, 5, 0, tzinfo=UTC), detail={"entity": "program", "key": "f-pil-2-0"})     # 1 Dec 00:00 EST
    return uid


def actions(r):
    assert r.status_code == 200, r.text
    return [a["action"] for a in r.json()]


def test_scope_is_derived_from_the_action(client, log):
    assert actions(client.get(A, headers=TAO, params={"scope": "reports"})) == ["regenerate", "publish", "override", "extract", "upload"]
    assert actions(client.get(A, headers=TAO, params={"scope": "platform"})) == ["master_change"] * 3
    both = client.get(A, headers=TAO).json()
    assert len(both) == 8 and [a["at"] for a in both] == sorted((a["at"] for a in both), reverse=True)


def test_extract_rows_keep_their_action_and_feed_failure_reason(client, log):
    with db.engine().begin() as c:
        c.execute(db_text("update setrep_upload set status = 'extraction_failed' where id = :id"), {"id": log})
    assert client.get(f"/api/v1/uploads/{log}", headers=TAO).json()["failure_reason"] == "cover block not found"
    assert actions(client.get(A, headers=TAO, params={"scope": "reports", "action": "extract"})) == ["extract"]


def db_text(sql):
    from sqlalchemy import text
    return text(sql)


def test_month_boundaries_are_toronto_calendar_months(client, log):
    oct_ = client.get(A, headers=TAO, params={"month": "2026-10"}).json()
    assert [(a["action"], a["at"][:16]) for a in oct_] == [("extract", "2026-11-01T03:30"), ("master_change", "2026-10-31T03:59"),
                                                           ("upload", "2026-10-15T12:00")]
    assert actions(client.get(A, headers=TAO, params={"month": "2026-11"})) == ["master_change", "regenerate", "publish", "override"]
    assert actions(client.get(A, headers=TAO, params={"month": "2026-12"})) == ["master_change"]
    assert actions(client.get(A, headers=TAO, params={"month": "2026-11", "scope": "platform"})) == ["master_change"]
    assert client.get(A, headers=TAO, params={"month": "2026-13"}).status_code == 422
    assert client.get(A, headers=TAO, params={"month": "Nov 2026"}).status_code == 422


def test_months_counts_newest_first(client, log):
    r = client.get(A + "/months", headers=TAO, params={"scope": "reports"})
    assert r.status_code == 200 and r.json() == [{"month": "2026-11", "count": 3}, {"month": "2026-10", "count": 2}]
    assert client.get(A + "/months", headers=TAO, params={"scope": "platform"}).json() == [
        {"month": "2026-12", "count": 1}, {"month": "2026-11", "count": 1}, {"month": "2026-10", "count": 1}]
    assert client.get(A + "/months", headers=TAO, params={"scope": "platform", "q": "move-trust"}).json() == [{"month": "2026-11", "count": 1}]
    assert client.get(A + "/months", headers=TAO).status_code == 422                       # scope is required


def test_search_covers_action_actor_reason_deal_and_detail(client, log):
    q = lambda v, **kw: actions(client.get(A, headers=TAO, params={"q": v, **kw}))
    assert q("overr") == ["override"]                                      # action
    assert q("SYSTEM") == ["extract"]                                      # actor, any case
    assert q("re-issued") == ["override"]                                  # reason
    assert q("Moneda") == ["publish", "override", "extract", "upload"]     # deal name, via the upload (regenerate names the program only)
    assert q("Essex") == ["master_change"]                                 # detail text
    assert q("R12", scope="reports") == ["override"]
    assert q("Essex", scope="reports") == []
    assert q("Moneda", month="2026-10") == ["extract", "upload"]
    assert q("100%") == [] and q("a_b") == []                              # LIKE wildcards are literal
    assert client.get(A, headers=TAO, params={"q": "x"}).status_code == 422               # minLength 2


def test_filters_actor_role_deal_and_paging(client, log):
    assert actions(client.get(A, headers=TAO, params={"actor_role": "system"})) == ["extract"]
    assert actions(client.get(A, headers=TAO, params={"deal_slug": DEAL})) == ["publish", "override", "extract", "upload"]
    assert actions(client.get(A, headers=TAO, params={"deal_slug": "nope"})) == []
    page1 = client.get(A, headers=TAO, params={"limit": 3}).json()
    page2 = client.get(A, headers=TAO, params={"limit": 3, "offset": 3}).json()
    page3 = client.get(A, headers=TAO, params={"limit": 3, "offset": 6}).json()
    assert [len(page1), len(page2), len(page3)] == [3, 3, 2]
    assert len({a["id"] for a in page1 + page2 + page3}) == 8
    for bad in ({"limit": 0}, {"limit": 501}, {"offset": -1}, {"scope": "everything"}):
        assert client.get(A, headers=TAO, params=bad).status_code == 422, bad


def test_upload_filter_still_spans_all_months(client, log):
    assert actions(client.get(A, headers=TAO, params={"upload_id": log})) == ["publish", "override", "extract", "upload"]


def test_roles(client, log):
    assert client.get(A, headers=ANALYST, params={"scope": "reports"}).status_code == 200
    assert client.get(A + "/months", headers=ANALYST, params={"scope": "reports"}).status_code == 200
    assert client.get(A + "/export.csv", headers=ANALYST, params={"scope": "reports", "month": "2026-11"}).status_code == 200
    for params in ({}, {"scope": "platform"}):
        assert client.get(A, headers=ANALYST, params=params).status_code == 403
    assert client.get(A + "/months", headers=ANALYST, params={"scope": "platform"}).status_code == 403
    assert client.get(A + "/export.csv", headers=ANALYST, params={"scope": "platform", "month": "2026-11"}).status_code == 403
    for h in (INV, MGR, {"X-Role": "investor_admin", "X-Partner": "investor"}):
        for scope in ("reports", "platform"):
            assert client.get(A, headers=h, params={"scope": scope}).status_code == 403
            assert client.get(A + "/months", headers=h, params={"scope": scope}).status_code == 403
            assert client.get(A + "/export.csv", headers=h, params={"scope": scope, "month": "2026-11"}).status_code == 403


def test_export_csv_one_month_one_scope_and_audits_itself(client, log):
    r = client.get(A + "/export.csv", headers=TAO, params={"scope": "reports", "month": "2026-11"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="audit-reports-2026-11.csv"' in r.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert [x["action"] for x in rows] == ["regenerate", "publish", "override"]
    assert all(x["scope"] == "reports" for x in rows)
    assert rows[1]["deal_slug"] == DEAL and rows[1]["upload_id"] == log and rows[1]["collection_period"] == "2026-09"
    assert rows[2]["reason"] == "servicer re-issued" and '"rule_id": "R12"' in rows[2]["detail"]
    assert rows[2]["at_toronto"].startswith("2026-11-01T00:00:00-04:00")
    ex = client.get(A, headers=TAO, params={"action": "export"}).json()
    assert len(ex) == 1 and ex[0]["upload_id"] is None and ex[0]["actor_role"] == "tao_admin"
    assert ex[0]["detail"] == {"scope": "reports", "month": "2026-11", "rows": 3, "format": "csv"}
    assert actions(client.get(A, headers=TAO, params={"scope": "platform", "action": "export"})) == ["export"]
    assert actions(client.get(A, headers=TAO, params={"scope": "reports", "action": "export"})) == []
    empty = client.get(A + "/export.csv", headers=TAO, params={"scope": "platform", "month": "2025-01"})
    assert empty.status_code == 200 and len(list(csv.reader(io.StringIO(empty.text)))) == 1      # header only
    for bad in ({"scope": "reports"}, {"month": "2026-11"}, {"scope": "reports", "month": "2026-1"}):
        assert client.get(A + "/export.csv", headers=TAO, params=bad).status_code == 422, bad
