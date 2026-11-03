"""Provenance: every leaf written into `deal` gets a `sources` entry keyed by its JSON pointer.

Read values carry the page, the bbox pdfplumber gave for the cell and the text as printed. Values computed from
read values (change_abs, utilization, covenant status, ...) carry the page of their first input and a raw_text
that starts with "derived:" and names the inputs. Template constants say so in raw_text.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from .mapper import F


def _esc(part: str) -> str:
    return str(part).replace("~", "~0").replace("/", "~1")


def pointer(*parts) -> str:
    return "/" + "/".join(_esc(p) for p in parts)


class Recorder:
    def __init__(self, pass_no: int = 1):
        self.deal: dict = {}
        self.sources: dict = {}
        self.pass_no = pass_no

    # ---- writing
    def _set(self, ptr: str, value: Any):
        parts = [p.replace("~1", "/").replace("~0", "~") for p in ptr.strip("/").split("/")]
        cur: Any = self.deal
        for i, p in enumerate(parts):
            last = i == len(parts) - 1
            nxt_is_index = (not last) and parts[i + 1].isdigit()
            if isinstance(cur, list):
                k = int(p)
                while len(cur) <= k:
                    cur.append(None)
                if last:
                    cur[k] = value
                else:
                    if cur[k] is None:
                        cur[k] = [] if nxt_is_index else {}
                    cur = cur[k]
            else:
                if last:
                    cur[p] = value
                else:
                    if cur.get(p) is None:
                        cur[p] = [] if nxt_is_index else {}
                    cur = cur[p]

    def read(self, ptr: str, f: Optional[F]):
        """A value read from the report (None -> null, with no source)."""
        if f is None:
            self._set(ptr, None)
            return
        self._set(ptr, f.value)
        if f.value is not None or f.raw:
            self.sources[ptr] = {"page": f.page, "bbox": f.bbox, "raw_text": str(f.raw),
                                 "confidence": f.confidence, "pass": self.pass_no}

    def derived(self, ptr: str, value: Any, formula: str, inputs: Iterable[Optional[F]] = ()):
        self._set(ptr, value)
        ins = [i for i in inputs if i is not None]
        page = ins[0].page if ins else 1
        shown = ", ".join(str(i.raw) for i in ins[:6])
        self.sources[ptr] = {"page": page, "bbox": None,
                             "raw_text": f"derived: {formula}" + (f" from [{shown}]" if shown else ""),
                             "confidence": min([i.confidence for i in ins], default=1.0), "pass": self.pass_no}

    def const(self, ptr: str, value: Any, why: str):
        self._set(ptr, value)
        if not isinstance(value, (dict, list)):
            self.sources[ptr] = {"page": 1, "bbox": None, "raw_text": f"template: {why}", "confidence": 1.0,
                                 "pass": self.pass_no}

    def empty(self, ptr: str, kind: str = "list"):
        """An empty container the dashboard expects (e.g. top10_obligors for a template without that table)."""
        self._set(ptr, [] if kind == "list" else {})


def leaves(obj: Any, prefix: str = "") -> Iterable[tuple[str, Any]]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from leaves(v, f"{prefix}/{_esc(k)}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from leaves(v, f"{prefix}/{i}")
    else:
        yield prefix, obj
