"""Loads seed/*.json into the database, idempotently (run it twice, get the same rows).

    python -m app.seed                          partners, programs, deals, covenant definitions
    python -m app.seed --reference-publications also publish the 12 real deal objects in docs/dashboard-json
                                                (demo data for the partner portals; skipped for periods
                                                that already have a publication)

Covenant definitions carry no id in the seed file; their id is a uuid5 of (deal, legal_ref, effective_from),
so re-running updates the same row instead of adding a copy."""
import json, pathlib, sys, uuid, datetime as dt
from sqlalchemy import select
from . import db
from .models import Partner, Program, Deal, CovenantDefinition, SetrepUpload, Publication, ReviewAction

HERE = pathlib.Path(__file__).resolve()
NS = uuid.UUID("6f1d3c52-7d0e-4c8e-9a51-2b7f0a1c9e10")
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}


def _first_dir(*cands):
    for c in cands:
        if c.is_dir():
            return c
    return cands[-1]


SEED = _first_dir(HERE.parents[1] / "seed", HERE.parents[2] / "seed")                 # /app/seed in compose
REFERENCE = _first_dir(HERE.parents[1] / "docs" / "dashboard-json", HERE.parents[2] / "docs" / "dashboard-json")


def covenant_id(row: dict) -> str:
    return str(uuid.uuid5(NS, f"{row['deal_slug']}|{row['legal_ref']}|{row['effective_from']}"))


def period_of(label: str) -> str:
    """'August 2026' -> '2026-08' (the deal object's collection_period label; see CLAUDE.md period naming)."""
    month, year = label.strip().rsplit(" ", 1)
    return f"{int(year):04d}-{MONTHS[month.lower()]:02d}"


def load(s, root: pathlib.Path = SEED) -> dict:
    counts = {}
    for name, model, key in [("partners", Partner, "slug"), ("programs", Program, "slug"), ("deals", Deal, "slug")]:
        rows = json.loads((root / f"{name}.json").read_text(encoding="utf-8"))
        for r in rows:
            s.merge(model(**r))
        s.flush()
        counts[name] = len(rows)
    rows = json.loads((root / "covenant_definitions.json").read_text(encoding="utf-8"))
    for r in rows:
        r = dict(r, effective_from=dt.date.fromisoformat(r["effective_from"]))
        s.merge(CovenantDefinition(id=covenant_id(dict(r, effective_from=r["effective_from"].isoformat())), **r))
    counts["covenant_definitions"] = len(rows)
    s.commit()
    return counts


def load_reference_publications(s, root: pathlib.Path = REFERENCE) -> int:
    """Publish each real deal object as if it had been uploaded and approved. Upload rows point at no file."""
    n = 0
    for f in sorted(root.glob("*.dashboard.json")):
        if f.name.startswith("program-"):
            continue
        deal = json.loads(f.read_text(encoding="utf-8"))
        period = period_of(deal["collection_period"])
        if s.scalar(select(Publication).where(Publication.deal_slug == deal["deal_slug"], Publication.collection_period == period)):
            continue
        up = SetrepUpload(id=str(uuid.uuid5(NS, f"ref-upload|{deal['deal_slug']}|{period}")), deal_slug=deal["deal_slug"],
                          collection_period=period, file_name=deal.get("source_file") or f.name, file_path="",
                          uploaded_by="seed", status="published")
        s.add(up); s.flush()
        s.add(Publication(upload_id=up.id, deal_slug=deal["deal_slug"], collection_period=period, published_by="seed", deal=deal))
        s.add(ReviewAction(upload_id=up.id, actor_role="seed", actor_label="reference data", action="publish",
                           detail={"source": f"docs/dashboard-json/{f.name}"}))
        n += 1
    s.commit()
    return n


if __name__ == "__main__":
    if db.database_url().startswith("sqlite"):
        db.create_all()
    with db.session() as s:
        for k, v in load(s).items():
            print(f"{k}: {v} rows")
        if "--reference-publications" in sys.argv:
            print("reference publications added:", load_reference_publications(s))
