"""Extraction agent owns this package. Entry point: extract(pdf_path, template_id, pages=None) -> extraction dict
(contracts/extraction.schema.json).

Pass 1 (pages=None): read every page, parse the template's sections, call the model only for cells the parser
could not place, derive the dashboard fields, return {meta, deal, sources}.

Pass 2 (pages=[...]): a re-read of those pages, returned as a patch: {meta (pass=2, pages_reread, row_keys),
deal: <only the leaves whose inputs are ALL on those pages>, sources}. `merge_patch(base, patch)` applies it to a
pass-1 result and returns a full extraction with meta.pass = 2.

How pass 2 stays consistent with pass 1 (audit H5):
- The whole document is parsed again and the deal object is built in full, exactly as in pass 1, so every list
  row sits at its real position and every derived value has all of its inputs. (A build from the re-read pages
  alone put the borrower-ratio rows at positions 0..n of ratio_history, under the wrong months, and derived
  covenant values, statuses and the covenant summary from half their inputs.) Only the patch is limited to the
  pages asked for.
- A leaf goes into the patch only when every page it was read or derived from is in `pages` (Recorder.inputs).
  A derived or aggregate leaf with an input on another page is left out, so the pass-1 value stands.
- List rows are matched to the base by their natural key, not by position (meta.row_keys: month, period,
  vintage label, legal ref + description, ratio key, tranche, rank). A row the base does not have is appended.
- A null in the patch never replaces a value the base has.
"""
from __future__ import annotations

import copy
import logging
import math
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from . import derive
from .mapper import F, ModelFallback, Parsed, load_template, parse
from .provenance import Recorder, leaves
from .status import UNREAD_CONFIDENCE
from .text import engine_version, pages_without_text, read_pdf

log = logging.getLogger("extract")
DEFAULT_TEMPLATE = "fpil-2.0-settrep-v1"


class ExtractionError(ValueError):
    """The PDF cannot be extracted with this template; the message is meant for the audit log as is."""

# fields the model fallback may fill, by Parsed attribute (simple label -> value sections only)
_FILLABLE = {"cover", "principal", "cost_of_funds", "enhancement", "aging", "funded_total", "contracts_total"}
_SECTION_ATTR = {"cover": "cover", "principal_balances": "principal", "cost_of_funds": "cost_of_funds",
                 "enhancement": "enhancement", "aging": "aging", "funded_contracts": "funded_total",
                 "outstanding_contracts": "contracts_total"}
_DATE_FORMATS = ("%B %d, %Y", "%b %d, %Y", "%Y-%m-%d", "%d %B %Y", "%d-%b-%y", "%d-%b-%Y")


def _is_date(s: str) -> bool:
    text = " ".join(s.split())
    for fmt in _DATE_FORMATS:
        for cand in (text, text.title()):
            try:
                datetime.strptime(cand, fmt)
                return True
            except ValueError:
                pass
    return False


def _cover_value_ok(fld: str, val) -> bool:
    """A cover value the rest of the extraction can use: the two fields that are parsed as dates downstream
    (a bad one used to raise and fail the whole upload) must parse; every cover field is non-empty text."""
    if not isinstance(val, str) or not val.strip():
        return False
    if fld == "collection_start":
        try:
            derive.parse_long_date(val)
        except ValueError:
            return False
    elif fld == "reporting_period":
        try:
            datetime.strptime(" ".join(val.split()).title(), "%B %Y")
        except ValueError:
            return False
    elif fld == "settlement_date":
        return _is_date(val)
    return True


def _apply_model_cells(p: Parsed, cells: list[dict], asked: Optional[list[tuple[str, str]]] = None,
                       pages: Optional[set[int]] = None):
    """Merge the model's answers into the parse. The model is not trusted (audit L6): a cell is accepted only if
    it is one of the fields asked for, its value is not null, its page is a page of this document (and one of the
    pages the model was shown, when `pages` is given), and the value is what the field holds: a finite number for
    an amount, a date that parses for the cover dates, non-empty text for the other cover fields. Anything else
    is dropped with a note and the field stays unplaced, so R01 names it; a bad answer never fails the upload and
    never overwrites a value the parser read."""
    from .parse import parse_number
    wanted = {(s, f) for s, f in (asked if asked is not None else [(u[0], u[1]) for u in p.unplaced])}
    for c in cells or []:
        if not isinstance(c, dict):
            continue
        name = c.get("field")
        sec, _, fld = name.partition(".") if isinstance(name, str) else ("", "", "")
        attr = _SECTION_ATTR.get(sec)

        def reject(why: str):
            p.notes.append(f"model answer for {name!r} not used: {why}")
            log.warning("model answer for %r not used: %s", name, why)

        if attr not in _FILLABLE or not fld or fld in ("*", "variant", "rows", "total", "row"):
            continue
        if (sec, fld) not in wanted:
            reject("the field was not asked for")
            continue
        val, page, raw = c.get("value"), c.get("page"), c.get("raw_text")
        if val is None:
            reject("no value")
            continue
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= max(p.page_count, 1) \
                or (pages is not None and page not in pages):
            reject(f"page {page!r} is not a page the model was given")
            continue
        if attr == "cover":
            if not _cover_value_ok(fld, val):
                reject(f"{val!r} is not a usable {fld}")
                continue
        else:
            if isinstance(val, str):
                try:
                    val = parse_number(val)
                except ValueError:
                    reject(f"{val!r} is not a number")
                    continue
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not math.isfinite(val):
                reject(f"{val!r} is not a number")
                continue
        getattr(p, attr)[fld] = F(val, page, raw if isinstance(raw, str) else str(val), None, confidence=0.6)
        p.unplaced = [u for u in p.unplaced if not (u[0] == sec and u[1] == fld)]
        p.notes.append(f"model placed {sec}.{fld} from page {page}")


class _DefaultEngine:
    """Template-driven section parsing (mapper.py) and dashboard derivation (derive.py)."""
    parse = staticmethod(parse)
    build = staticmethod(derive.build)


def _pick_layout(tpl: dict, page1) -> str:
    """A dispatch template lists document layouts sharing one template id (e.g. every MOVE Trust deal is
    `move-trust-settrep-v1`): the first layout whose keywords all appear on page 1 wins."""
    from .text import norm
    text = norm(page1.text)
    for lay in tpl["layouts"]:
        if all(norm(k) in text for k in lay.get("when_page1_has", [])):
            return lay["template"]
    raise ExtractionError(f"page 1 matches none of the layouts of {tpl['template_id']}")


def _engine(tpl: dict):
    """A template may name an engine module under worker/extract/engines/ (`engine: <module>`) when its
    documents need parsing the default section parsers cannot express. The module provides
    parse(pages, page_count, tpl) -> mapper.Parsed and build(parsed, recorder, *, prior, partial)."""
    name = tpl.get("engine")
    if not name:
        return _DefaultEngine
    import importlib
    return importlib.import_module(f".engines.{name}", __package__)


# ---------------------------------------------------------------- list rows by natural key
_ROW_KEY_FIELDS = ("month", "period", "annual_period", "semi_annual_period", "key", "tranche", "rank")


def row_key(row: Any) -> Optional[str]:
    """What a list row IS, whatever its position: a covenant by legal ref + description, a ratio-history row by
    month, a period / aging row by period, a CNL row by its vintage label, a financial ratio by key, a tranche or
    mover row by tranche, an obligor by rank. None for a row with no such field (matched by position)."""
    if not isinstance(row, dict):
        return None
    if row.get("legal_ref") is not None:
        return f"legal_ref:{row['legal_ref']}|{row.get('description')}"
    for k in _ROW_KEY_FIELDS:
        if row.get(k) is not None:
            return f"{k}:{row[k]}"
    return None


def _unique_keys(rows: list) -> list:
    """row_key per row; a repeated key gets #2, #3, ... in order, so equal rows still pair up one to one."""
    seen: dict[str, int] = {}
    out = []
    for r in rows:
        k = row_key(r)
        if k is not None:
            seen[k] = seen.get(k, 0) + 1
            if seen[k] > 1:
                k = f"{k}#{seen[k]}"
        out.append(k)
    return out


def row_keys(obj: Any, prefix: str = "") -> dict[str, list]:
    """{pointer of each list of rows: its row keys} for a deal object."""
    out: dict[str, list] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(row_keys(v, f"{prefix}/{str(k).replace('~', '~0').replace('/', '~1')}"))
    elif isinstance(obj, list):
        if any(isinstance(x, dict) for x in obj):
            out[prefix] = _unique_keys(obj)
        for i, v in enumerate(obj):
            out.update(row_keys(v, f"{prefix}/{i}"))
    return out


def _lookup(doc: Any, ptr: str):
    """(found, value) at a JSON pointer."""
    cur = doc
    for part in [x.replace("~1", "/").replace("~0", "~") for x in ptr.split("/")[1:]]:
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return False, None
    return True, cur


# ---------------------------------------------------------------- extraction
def extract(pdf_path: str, template_id: str = DEFAULT_TEMPLATE, pages: Optional[list[int]] = None, *,
            upload_id: str | None = None, prior: dict | None = None, model: ModelFallback | None = None) -> dict:
    tpl = load_template(template_id)
    # pass 2 parses the whole document too (module docstring): positions and cross-page inputs need all of it
    read, page_count = read_pdf(pdf_path)
    if pages:
        pages = sorted({int(x) for x in pages})
        outside = [x for x in pages if not 1 <= x <= page_count]
        if outside:
            raise ExtractionError(f"pages {outside} are not in this {page_count}-page document")
    layout_id = None
    if tpl.get("layouts"):
        first = read[0] if read and read[0].number == 1 else read_pdf(pdf_path, [1])[0][0]
        layout_id = _pick_layout(tpl, first)
        tpl = load_template(layout_id)
    no_text = pages_without_text(read)
    if no_text:
        log.warning("pages without a text layer (OCR fallback not built yet): %s", no_text)
    engine = _engine(tpl)
    p = engine.parse(read, page_count, tpl)
    p.source_file = Path(pdf_path).name
    pass_no = 2 if pages else 1

    model = model or ModelFallback()
    asked = [(u[0], u[1]) for u in p.unplaced]
    if asked:
        hint_pages = sorted({u[2] for u in p.unplaced if u[2]} or {1})
        texts = {pg.number: pg.text for pg in read if pg.number in hint_pages}
        _apply_model_cells(p, model.ask(asked, texts), asked, set(texts))

    if "collection_start" not in p.cover:
        # without the cover block there is no period to file the report under; say why in plain words
        if 1 in no_text:
            raise ExtractionError("page 1 has no text layer; cover block not found"
                                  + (" (no page has text: scanned or blank PDF, OCR fallback not built yet)"
                                     if len(no_text) == page_count else ""))
        raise ExtractionError("cover block not found on page 1 (no 'Collection Period Start Date'); "
                              f"is this a {template_id} settlement report?")

    rec = Recorder(pass_no)
    engine.build(p, rec, prior=prior, partial=False)
    _mark_unread_covenants(rec)

    rp = p.cover.get("reporting_period")
    reporting_period = None
    if rp is not None and isinstance(rp.value, str):
        try:
            d = datetime.strptime(" ".join(rp.value.split()).title(), "%B %Y")
            reporting_period = f"{d.year:04d}-{d.month:02d}"
        except ValueError:
            p.notes.append(f"reporting period {rp.value!r} on page {rp.page} is not a month and year")

    n_req = 40
    confidence = round(max(0.0, 1.0 - len(p.unplaced) / n_req), 3)
    if any(s.get("confidence", 1) < 1 for s in rec.sources.values()):
        confidence = min(confidence, 0.9)
    meta: dict[str, Any] = {
        "upload_id": upload_id or str(uuid.uuid4()),
        "pass": pass_no,
        "template_id": template_id,
        "layout": layout_id,
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
        meta["pages_reread"] = pages
        meta["row_keys"] = row_keys(rec.deal)
        keep = set(pages)
        deal_leaves = {ptr: v for ptr, v in leaves(rec.deal)
                       if ptr in rec.sources and rec.inputs.get(ptr, {rec.sources[ptr]["page"]}) <= keep}
        return {"meta": meta, "deal": _nest(deal_leaves),
                "sources": {k: v for k, v in rec.sources.items() if k in deal_leaves}}
    return {"meta": meta, "deal": rec.deal, "sources": rec.sources}


def _mark_unread_covenants(rec: Recorder):
    """Two things every engine needs after its covenants are written.
    A ceiling / floor covenant whose status could not be derived (no value read, or no threshold: status null,
    audit M4) gets a low provenance confidence on that status, which also caps meta.confidence.
    covenant_summary and worst_status are counted over every covenant, so their inputs are every page any
    covenant was read from, not only the first one their provenance names."""
    covs = rec.deal.get("covenants")
    if not isinstance(covs, list):
        return
    for i, c in enumerate(covs):
        if isinstance(c, dict) and c.get("kind") in ("ceiling", "floor") and c.get("status") is None:
            ptr = f"/covenants/{i}/status"
            src = rec.sources.get(ptr)
            if src is None:      # an engine that writes a null without provenance: point at the covenant's own row
                anchor = next((rec.sources[k] for k in (f"/covenants/{i}/description", f"/covenants/{i}/legal_ref") if k in rec.sources), None)
                if anchor is None:
                    continue
                src = rec.sources[ptr] = {"page": anchor["page"], "bbox": None, "pass": rec.pass_no,
                                          "raw_text": "derived: no status, the covenant's value or threshold was not read"}
                rec.inputs[ptr] = {anchor["page"]}
            src["confidence"] = min(src.get("confidence") or 1.0, UNREAD_CONFIDENCE)
    pages = set()
    for ptr, ins in rec.inputs.items():
        if ptr.startswith("/covenants/"):
            pages |= ins
    if pages:
        for ptr in list(rec.inputs):
            if ptr == "/worst_status" or ptr.startswith("/covenant_summary/"):
                rec.inputs[ptr] = rec.inputs[ptr] | pages


def _nest(flat: dict[str, Any]) -> dict:
    r = Recorder()
    for ptr, v in flat.items():
        r._set(ptr, v)
    return r.deal


def merge_patch(base: dict, patch: dict) -> dict:
    """Apply a pass-2 patch to a pass-1 extraction. Returns a new, full extraction with meta.pass = 2.

    The patch's leaves are its `sources` keys (a patch list is sparse: positions it does not carry are padding,
    not nulls to write). Each list index in a leaf's pointer is translated from the patch's row to the base row
    with the same natural key (patch meta.row_keys; a patch without row_keys, from an older worker, is applied by
    position). A row the base does not have is appended. A null never replaces a base value."""
    out = copy.deepcopy(base)
    r = Recorder(2)
    r.deal = out["deal"]
    keys = patch.get("meta", {}).get("row_keys") or {}
    base_keys: dict[str, list] = {}       # base list pointer -> its row keys before this merge
    appended: dict[tuple[str, str], int] = {}

    def translate(ptr: str) -> str:
        parts = ptr.split("/")[1:]
        src, dst = "", ""
        for part in parts:
            klist = keys.get(src)
            if part.isdigit() and klist is not None:
                key = klist[int(part)] if int(part) < len(klist) else None
                found, rows = _lookup(out["deal"], dst)
                idx = int(part)
                if key is not None and found and isinstance(rows, list):
                    if dst not in base_keys:
                        base_keys[dst] = _unique_keys(rows)
                    if key in base_keys[dst]:
                        idx = base_keys[dst].index(key)
                    else:
                        if (dst, key) not in appended:
                            appended[(dst, key)] = len(base_keys[dst]) + sum(1 for d, _ in appended if d == dst)
                        idx = appended[(dst, key)]
                dst += f"/{idx}"
            else:
                dst += f"/{part}"
            src += f"/{part}"
        return dst

    for ptr, src in patch.get("sources", {}).items():
        found, v = _lookup(patch["deal"], ptr)
        if not found:
            continue
        target = translate(ptr)
        had, old = _lookup(out["deal"], target)
        if v is None and had and old is not None:
            continue                      # a re-read that found nothing does not erase what pass 1 read
        r._set(target, v)
        out["sources"][target] = src
    out["meta"]["pass"] = 2
    out["meta"]["pages_reread"] = patch["meta"].get("pages_reread", [])
    out["meta"]["extracted_at"] = patch["meta"]["extracted_at"]
    # what the extraction could not read, after the re-read: a field still unplaced in both; the pages with no
    # text layer as the re-read saw them (the same document)
    if "unplaced" in patch["meta"]:
        still = set(patch["meta"]["unplaced"] or [])
        out["meta"]["unplaced"] = [u for u in out["meta"].get("unplaced") or [] if u in still]
    if "pages_without_text" in patch["meta"]:
        out["meta"]["pages_without_text"] = patch["meta"]["pages_without_text"]
    return out


__all__ = ["extract", "merge_patch", "row_key", "row_keys", "DEFAULT_TEMPLATE", "ExtractionError"]
