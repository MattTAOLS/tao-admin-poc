from sqlalchemy import select, func
from app import db, seed
from app.models import Partner, Program, Deal, CovenantDefinition, Publication


def counts(s):
    return {m.__name__: s.scalar(select(func.count()).select_from(m)) for m in (Partner, Program, Deal, CovenantDefinition, Publication)}


def test_seed_is_idempotent():
    with db.session() as s:
        first = counts(s)
        seed.load(s); seed.load(s)
        assert counts(s) == first
        assert first == {"Partner": 2, "Program": 2, "Deal": 12, "CovenantDefinition": 21, "Publication": 0}


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
