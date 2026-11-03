"""Queue consumer. Job = {"upload_id": ..., "pass": 1|2, "pages": [...], "template_id"?: ...}.
Flow: load PDF -> extract/ (text layer, OCR fallback later) -> validate/ (rules package) -> write extraction +
findings -> set upload status.

The Extraction agent owns the extract step (`run_job`). Persistence and validation belong to the adapter in
worker/validate/ (Rules agent) and the API: if `validate.handle_extraction(job, extraction)` exists it is called;
until then the extraction is written as JSON next to the upload so the hand-off can be inspected.
"""
import json
import logging
import os
from pathlib import Path

try:                                   # in the container the worker folder is the working directory
    from extract import DEFAULT_TEMPLATE, extract, merge_patch
except ImportError:                    # from the repo root: python -m worker.main
    from worker.extract import DEFAULT_TEMPLATE, extract, merge_patch

log = logging.getLogger("worker")
QUEUE = "extract:jobs"


def upload_dir(upload_id: str, file_store: str | None = None) -> Path:
    return Path(file_store or os.environ.get("FILE_STORE", "/data")) / "uploads" / upload_id


def run_job(job: dict, file_store: str | None = None, base: dict | None = None) -> dict:
    """Extract one job. Pass 2 re-reads `pages` and, given the pass-1 extraction as `base` (or found on disk),
    returns the merged full extraction (meta.pass = 2)."""
    upload_id = job["upload_id"]
    folder = upload_dir(upload_id, file_store)
    pdf = folder / "source.pdf"
    template_id = job.get("template_id") or DEFAULT_TEMPLATE
    if int(job.get("pass", 1)) == 2:
        pages = [int(p) for p in job.get("pages") or []]
        if not pages:
            raise ValueError("pass-2 job without pages")
        patch = extract(str(pdf), template_id, pages=pages, upload_id=upload_id)
        if base is None and (folder / "extraction-pass1.json").exists():
            base = json.loads((folder / "extraction-pass1.json").read_text(encoding="utf-8"))
        return merge_patch(base, patch) if base else patch
    return extract(str(pdf), template_id, upload_id=upload_id)


def handle(job: dict):
    extraction = run_job(job)
    folder = upload_dir(job["upload_id"])
    out = folder / f"extraction-pass{extraction['meta']['pass']}.json"
    out.write_text(json.dumps(extraction, indent=1), encoding="utf-8")
    log.info("extracted %s pass %s -> %s (unplaced: %s)", job["upload_id"], extraction["meta"]["pass"], out,
             extraction["meta"].get("unplaced"))
    try:
        try:
            from validate import handle_extraction
        except ImportError:
            from worker.validate import handle_extraction
    except ImportError:
        log.info("validate.handle_extraction not available yet; extraction left at %s", out)
        return extraction
    handle_extraction(job, extraction)
    return extraction


if __name__ == "__main__":
    import redis
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    r = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    print("worker up; waiting on", QUEUE, flush=True)
    while True:
        item = r.blpop(QUEUE, timeout=5)
        if item:
            job = json.loads(item[1])
            try:
                handle(job)
            except Exception:
                log.exception("job failed: %s", job)
