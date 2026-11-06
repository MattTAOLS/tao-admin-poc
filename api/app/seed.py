"""Loads seed/*.json into the database, idempotently (run it twice, get the same rows).

    python -m app.seed                          partners, programs, deals, covenant definitions, sample users (if missing)
    python -m app.seed --reference-publications also publish the 12 real deal objects in docs/dashboard-json
                                                (demo data for the partner portals; skipped for periods
                                                that already have a publication)

Covenant definitions carry no id in the seed file; a deal's definitions are compared by content with its current
rows (migration 007): identical rows are left alone, rows the file no longer has are marked superseded_at = now, new
ones are inserted (first version id = uuid5 of deal, legal_ref, effective_from). Re-running with the same file is a no-op.
Only rows the seed created (origin = seed) are compared and superseded; rows a TAO Admin changed or added in the UI
(origin = ui, migration 009) are never touched, and a file row is not inserted where a ui row holds the same
(legal_ref, effective_from): the UI correction stands (risk R11)."""
import json, pathlib, sys, uuid, datetime as dt
from sqlalchemy import select
from . import db, views
from .models import Partner, Program, Deal, CovenantDefinition, SetrepUpload, Publication, ReviewAction, AppUser, new_id, utcnow

HERE = pathlib.Path(__file__).resolve()
NS = uuid.UUID("6f1d3c52-7d0e-4c8e-9a51-2b7f0a1c9e10")
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}


def _first_dir(*cands, has: str):
    """First candidate that holds the expected content (`has` is a glob). An empty folder is skipped: compose leaves
    empty mount points such as api/seed behind in the checkout. Falls back to the last candidate."""
    for c in cands:
        if c.is_dir() and any(c.glob(has)):
            return c
    return cands[-1]


SEED = _first_dir(HERE.parents[1] / "seed", HERE.parents[2] / "seed", has="partners.json")                 # /app/seed in compose
REFERENCE = _first_dir(HERE.parents[1] / "docs" / "dashboard-json", HERE.parents[2] / "docs" / "dashboard-json",
                       has="*.dashboard.json")


def covenant_id(row: dict) -> str:
    return str(uuid.uuid5(NS, f"{row['deal_slug']}|{row['legal_ref']}|{row['effective_from']}"))


def period_of(label: str) -> str:
    """'August 2026' -> '2026-08' (the deal object's collection_period label; see CLAUDE.md period naming)."""
    month, year = label.strip().rsplit(" ", 1)
    return f"{int(year):04d}-{MONTHS[month.lower()]:02d}"


def load(s, root: pathlib.Path = SEED) -> dict:
    counts = {}
    for name, model in [("partners", Partner), ("programs", Program), ("deals", Deal)]:
        rows = json.loads((root / f"{name}.json").read_text(encoding="utf-8"))
        for r in rows:
            r = dict(r)
            slugs = r.pop("partner_slugs", None)
            if model is Program:
                slugs = slugs or [r["partner_slug"]]
                r["partner_slug"] = slugs[0]
            row = s.merge(model(**r))
            if model is Program:
                s.flush()
                views.set_partner_slugs(s, row, slugs)
        s.flush()
        counts[name] = len(rows)
    rows = json.loads((root / "covenant_definitions.json").read_text(encoding="utf-8"))
    counts["covenant_definitions"] = len(rows)
    counts["covenant_definitions_superseded"] = load_covenants(s, rows)
    if (root / "users.json").exists():
        counts["users_added"] = load_users(s, json.loads((root / "users.json").read_text(encoding="utf-8")))
    s.commit()
    return counts


def load_users(s, rows: list[dict]) -> int:
    """seed/users.json (wave C): add each sample user whose id and email are both new. A user already there is never
    changed, so a name, role or status edited in the app survives every seed run. Subscriptions start empty."""
    n = 0
    for r in rows:
        email = r["email"].strip().lower()
        if s.get(AppUser, r["id"]) is not None or s.scalar(select(AppUser.id).where(AppUser.email == email)) is not None:
            continue
        s.add(AppUser(id=r["id"], email=email, name=r["name"], role=r["role"], partner_slug=r.get("partner_slug"), status="active"))
        n += 1
    s.flush()
    return n


COVENANT_FIELDS = ("legal_ref", "description", "kind", "threshold", "threshold_rule", "watch_buffer_pct", "effective_from", "unit", "source")


def _num(v):
    return None if v is None else round(float(v), 6)


def covenant_key(r) -> tuple:
    """What makes two definitions the same, for a seed row (dict) or a stored row (CovenantDefinition)."""
    g = r.get if isinstance(r, dict) else lambda k, d=None: getattr(r, k, d)
    eff = g("effective_from")
    return (g("legal_ref"), g("description"), g("kind"), _num(g("threshold")),
            json.dumps(g("threshold_rule"), sort_keys=True) if g("threshold_rule") is not None else None,
            _num(0.1 if g("watch_buffer_pct") is None else g("watch_buffer_pct")),
            eff.isoformat() if isinstance(eff, dt.date) else str(eff)[:10], g("unit"), g("source"))


def load_covenants(s, rows: list[dict]) -> int:
    """Per deal in the file: current seed rows (superseded_at is null, origin seed) the file no longer contains get superseded_at = now;
    file rows with no identical current row are inserted. Unchanged rows are left alone, so a re-run with the same file
    changes nothing. Deals absent from the file keep their rows. Returns the number of rows superseded.
    A new row takes the stable uuid5 id unless an earlier (now superseded) version already holds it."""
    now, superseded = utcnow(), 0
    by_deal: dict[str, list[dict]] = {}
    for r in rows:
        by_deal.setdefault(r["deal_slug"], []).append(r)
    for slug, want in by_deal.items():
        live = s.scalars(select(CovenantDefinition).where(CovenantDefinition.deal_slug == slug,
                                                           CovenantDefinition.superseded_at.is_(None))).all()
        current = [c for c in live if (c.origin or "seed") == "seed"]
        held_by_ui = {(c.legal_ref, c.effective_from.isoformat()) for c in live if c.origin == "ui"}
        keep = {covenant_key(r) for r in want}
        have = set()
        for c in current:
            k = covenant_key(c)
            if k in keep and k not in have:
                have.add(k)
            else:                                         # gone from the file, changed, or a duplicate
                c.superseded_at = now; superseded += 1
        s.flush()
        for r in want:
            k = covenant_key(r)
            if k in have or (r["legal_ref"], str(r["effective_from"])[:10]) in held_by_ui:
                continue
            have.add(k)
            cid = covenant_id(r)
            if s.get(CovenantDefinition, cid) is not None:
                cid = new_id()
            data = {f: r.get(f) for f in COVENANT_FIELDS}
            data["effective_from"] = dt.date.fromisoformat(r["effective_from"])
            if data["watch_buffer_pct"] is None:
                data.pop("watch_buffer_pct")
            s.add(CovenantDefinition(id=cid, deal_slug=slug, origin="seed", **data))
        s.flush()
    return superseded


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
    else:                                      # same runner as API start-up; a no-op when the API already migrated
        from app import migrate
        migrate.run(db.engine())
    with db.session() as s:
        for k, v in load(s).items():
            print(f"{k}: {v} rows")
        if "--reference-publications" in sys.argv:
            print("reference publications added:", load_reference_publications(s))
