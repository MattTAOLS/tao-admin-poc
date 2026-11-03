"""Extraction agent owns this package. Entry point: extract(pdf_path, template_id, pages=None) -> extraction dict
(contracts/extraction.schema.json).

Pass 1 (pages=None): read every page, parse the template's sections, call the model only for cells the parser
could not place, derive the dashboard fields, return {meta, deal, sources}.

Pass 2 (pages=[...]): re-read only those pages and return a patch: {meta (pass=2, pages_reread), deal: <only the
leaves whose inputs are on those pages>, sources}. `merge_patch(base, patch)` applies it to a pass-1 result and
returns a full extraction with meta.pass = 2. Cross-page derived fields are recomputed only when all their input
pages are in the patch; otherwise the base values stand.
"""
from __future__ import annotations

import copy
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from . import derive
from .mapper import F, ModelFallback, Parsed, load_template, parse
from .provenance import Recorder, leaves
from .text import engine_version, pages_without_text, read_pdf

log = logging.getLogger("extract")
DEFAULT_TEMPLATE = "fpil-2.0-settrep-v1"

# fields the model fallback may fill, by Parsed attribute (simple label -> value sections only)
_FILLABLE = {"cover", "principal", "cost_of_funds", "enhancement", "aging", "funded_total", "contracts_total"}
_SECTION_ATTR = {"cover": "cover", "principal_balances": "principal", "cost_of_funds": "cost_of_funds",
                 "enhancement": "enhancement", "aging": "aging", "funded_contracts": "funded_total",
                 "outstanding_contracts": "contracts_total"}


def _apply_model_cells(p: Parsed, cells: list[dict]):
    from .parse import parse_number
    for c in cells:
        sec, _, fld = c["field"].partition(".")
        attr = _SECTION_ATTR.get(sec)
        if attr not in _FILLABLE or not fld or fld in ("*", "variant", "rows", "total", "row"):
            continue
        val = c["value"]
        if isinstance(val, str) and attr != "cover":
            try:
                val = parse_number(val)
            except ValueError:
                continue
        getattr(p, attr)[fld] = F(val, c["page"], c["raw_text"], None, confidence=0.6)
        p.unplaced = [u for u in p.unplaced if not (u[0] == sec and u[1] == fld)]
        p.notes.append(f"model placed {sec}.{fld} from page {c['page']}")


def extract(pdf_path: str, template_id: str = DEFAULT_TEMPLATE, pages: Optional[list[int]] = None, *,
            upload_id: str | None = None, prior: dict | None = None, model: ModelFallback | None = None) -> dict:
    tpl = load_template(template_id)
    read, page_count = read_pdf(pdf_path, pages)
    no_text = pages_without_text(read)
    if no_text:
        log.warning("pages without a text layer (OCR fallback not built yet): %s", no_text)
    p = parse(read, page_count, tpl)
    p.source_file = Path(pdf_path).name
    pass_no = 2 if pages else 1

    model = model or ModelFallback()
    asked = [(u[0], u[1]) for u in p.unplaced]
    if asked and not pages:
        hint_pages = sorted({u[2] for u in p.unplaced if u[2]} or {1})
        texts = {pg.number: pg.text for pg in read if pg.number in hint_pages}
        _apply_model_cells(p, model.ask(asked, texts))

    rec = Recorder(pass_no)
    derive.build(p, rec, prior=prior, partial=bool(pages))

    rp = p.cover.get("reporting_period")
    reporting_period = None
    if rp is not None:
        d = datetime.strptime(rp.value.title(), "%B %Y")
        reporting_period = f"{d.year:04d}-{d.month:02d}"

    n_req = 40
    confidence = round(max(0.0, 1.0 - len(p.unplaced) / n_req), 3)
    if any(s.get("confidence", 1) < 1 for s in rec.sources.values()):
        confidence = min(confidence, 0.9)
    meta: dict[str, Any] = {
        "upload_id": upload_id or str(uuid.uuid4()),
        "pass": pass_no,
        "template_id": template_id,
        "page_count": page_count,
        "reporting_period": reporting_period,
        "extracted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "engine": {"text_layer": engine_version(), "ocr": None, "model": model.model or "none (not configured)"},
        "confidence": confidence,
        "unplaced": [f"{s}.{f}" for s, f, _ in p.unplaced],
        "notes": p.notes,
        "pages_without_text": no_text,
        "model_calls": model.calls,
    }
    if pages:
        meta["pages_reread"] = sorted(pages)
        keep = set(pages)
        deal_leaves = {ptr: v for ptr, v in leaves(rec.deal)
                       if ptr in rec.sources and rec.sources[ptr]["page"] in keep}
        return {"meta": meta, "deal": _nest(deal_leaves),
                "sources": {k: v for k, v in rec.sources.items() if k in deal_leaves}}
    return {"meta": meta, "deal": rec.deal, "sources": rec.sources}


def _nest(flat: dict[str, Any]) -> dict:
    r = Recorder()
    for ptr, v in flat.items():
        r._set(ptr, v)
    return r.deal


def merge_patch(base: dict, patch: dict) -> dict:
    """Apply a pass-2 patch to a pass-1 extraction. Returns a new, full extraction with meta.pass = 2."""
    out = copy.deepcopy(base)
    r = Recorder(2)
    r.deal = out["deal"]
    for ptr, v in leaves(patch["deal"]):
        r._set(ptr, v)
        if ptr in patch["sources"]:
            out["sources"][ptr] = patch["sources"][ptr]
    out["meta"]["pass"] = 2
    out["meta"]["pages_reread"] = patch["meta"].get("pages_reread", [])
    out["meta"]["extracted_at"] = patch["meta"]["extracted_at"]
    return out


__all__ = ["extract", "merge_patch", "DEFAULT_TEMPLATE"]
