import json
from sqlalchemy import select, func
from app import db, seed
from app.models import Partner, Program, Deal, CovenantDefinition, Publication, SetrepUpload


def counts(s):
    return {m.__name__: s.scalar(select(func.count()).select_from(m)) for m in (Partner, Program, Deal, CovenantDefinition, Publication)}


def test_seed_is_idempotent():
    with db.session() as s:
        first = counts(s)
        seed.load(s); seed.load(s)
        assert counts(s) == first
        n = {f: len(json.loads((seed.SEED / f"{f}.json").read_text(encoding="utf-8"))) for f in ("partners", "programs", "deals", "covenant_definitions")}
        assert first == {"Partner": n["partners"], "Program": n["programs"], "Deal": n["deals"],
                         "CovenantDefinition": n["covenant_definitions"], "Publication": 0}


def test_seed_values_round_trip():
    with db.session() as s:
        p = s.get(Program, "move-trust")
        assert p.limit == 1916709163.0 and p.partner_slug == "investor"
        c = s.scalars(select(CovenantDefinition).where(CovenantDefinition.legal_ref == "SLFA 9.1 (c)")).first()
        assert c.threshold is None and c.threshold_rule["bands"][0]["threshold"] == 0.06


def test_reference_publications_are_idempotent():
    with db.session() as s:
        assert seed.load_reference_publications(s) == 12
        assert seed.load_reference_publications(s) == 0
        assert counts(s)["Publication"] == 12


def test_period_of():
    assert seed.period_of("August 2026") == "2026-08" and seed.period_of("July 2026") == "2026-07"


def test_seed_dir_skips_empty_decoy(tmp_path):
    decoy, real = tmp_path / "api" / "seed", tmp_path / "seed"
    decoy.mkdir(parents=True); real.mkdir()
    (real / "partners.json").write_text("[]")
    assert seed._first_dir(decoy, real, has="partners.json") == real
    (decoy / "partners.json").write_text("[]")
    assert seed._first_dir(decoy, real, has="partners.json") == decoy        # populated first candidate still wins
    assert seed._first_dir(tmp_path / "nope", tmp_path / "also-nope", has="partners.json") == tmp_path / "also-nope"


def test_reference_dir_skips_empty_decoy(tmp_path):
    decoy, real = tmp_path / "api" / "docs" / "dashboard-json", tmp_path / "docs" / "dashboard-json"
    decoy.mkdir(parents=True); real.mkdir(parents=True)
    (real / "x.dashboard.json").write_text("{}")
    assert seed._first_dir(decoy, real, has="*.dashboard.json") == real
    assert seed.SEED.joinpath("partners.json").exists() and any(seed.REFERENCE.glob("*.dashboard.json"))


def _copy_seed(tmp_path):
    for f in seed.SEED.glob("*.json"):
        (tmp_path / f.name).write_bytes(f.read_bytes())
    return tmp_path


def _current(s, slug=None):
    q = select(CovenantDefinition).where(CovenantDefinition.superseded_at.is_(None))
    return s.scalars(q.where(CovenantDefinition.deal_slug == slug) if slug else q).all()


def test_reseed_unchanged_supersedes_nothing(tmp_path):
    root = _copy_seed(tmp_path)
    with db.session() as s:
        before = counts(s)["CovenantDefinition"]
        assert seed.load(s, root)["covenant_definitions_superseded"] == 0
        assert seed.load(s)["covenant_definitions_superseded"] == 0
        assert counts(s)["CovenantDefinition"] == before == len(_current(s))


def test_reseed_changed_threshold_supersedes_one_row(tmp_path, client):
    from conftest import TAO
    root = _copy_seed(tmp_path)
    rows = json.loads((root / "covenant_definitions.json").read_text(encoding="utf-8"))
    i = next(i for i, r in enumerate(rows) if r["deal_slug"] == "f-pil-2-0-moneda-capital-corp" and r["legal_ref"] == "SLFA 9.1 (e)")
    assert rows[i]["threshold"] == 0.035
    rows[i]["threshold"] = 0.04
    (root / "covenant_definitions.json").write_text(json.dumps(rows), encoding="utf-8")
    deal = "f-pil-2-0-moneda-capital-corp"
    with db.session() as s:
        total, n_deal = counts(s)["CovenantDefinition"], len(_current(s, deal))
        old_id = next(c.id for c in _current(s, deal) if c.legal_ref == "SLFA 9.1 (e)")
        assert seed.load(s, root)["covenant_definitions_superseded"] == 1
        assert counts(s)["CovenantDefinition"] == total + 1 and len(_current(s, deal)) == n_deal
        gone = s.get(CovenantDefinition, old_id)
        assert gone.superseded_at is not None and gone.threshold == 0.035
        new = [c for c in _current(s, deal) if c.legal_ref == "SLFA 9.1 (e)"]
        assert len(new) == 1 and new[0].threshold == 0.04 and new[0].id != old_id
        assert seed.load(s, root)["covenant_definitions_superseded"] == 0          # idempotent on the changed file
        assert counts(s)["CovenantDefinition"] == total + 1
    for params in ({"deal_slug": deal}, {"deal_slug": deal, "as_of": "2026-08-31"}, {}):
        got = client.get("/api/v1/master/covenants", headers=TAO, params=params).json()
        e = [c for c in got if c["deal_slug"] == deal and c["legal_ref"] == "SLFA 9.1 (e)"]
        assert [c["threshold"] for c in e] == [0.04] and old_id not in {c["id"] for c in got}
    # reverting the file supersedes the 0.04 row and brings back 0.035 as a new current row
    with db.session() as s:
        assert seed.load(s)["covenant_definitions_superseded"] == 1
        e = [c for c in _current(s, deal) if c.legal_ref == "SLFA 9.1 (e)"]
        assert [c.threshold for c in e] == [0.035] and counts(s)["CovenantDefinition"] == total + 2


def test_review_context_skips_superseded(tmp_path):
    from app import review
    root = _copy_seed(tmp_path)
    rows = json.loads((root / "covenant_definitions.json").read_text(encoding="utf-8"))
    for r in rows:
        if r["deal_slug"] == "f-pil-2-0-moneda-capital-corp" and r["legal_ref"] == "SLFA 9.1 (e)":
            r["threshold"] = 0.04
    (root / "covenant_definitions.json").write_text(json.dumps(rows), encoding="utf-8")
    with db.session() as s:
        seed.load(s, root)
        u = SetrepUpload(deal_slug="f-pil-2-0-moneda-capital-corp", collection_period="2026-08", file_name="x.pdf",
                         file_path="", uploaded_by="test", status="needs_review")
        s.add(u); s.flush()
        defs = review.build_context(s, u).master["covenants"]
        assert [c["threshold"] for c in defs if c["legal_ref"] == "SLFA 9.1 (e)"] == [0.04]
        assert len({c["legal_ref"] for c in defs}) == len(defs)
