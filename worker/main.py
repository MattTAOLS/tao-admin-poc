"""Queue consumer. Job = {"upload_id": ..., "pass": 1|2, "pages": [...], "template_id"?: ...}.
Flow: load PDF -> extract/ (text layer, OCR fallback later) -> validate/ (rules package) -> write extraction +
findings -> set upload status.

The Extraction agent owns the extract step (`run_job`). Every database write belongs to the adapter in
worker/validate/ (Rules agent): mark_extracting(upload_id), handle_extraction(job, extraction) (extraction row,
rules, findings, pass-2 queueing, needs_review) and mark_failed(upload_id, error). The extraction is also
written as FILE_STORE/uploads/<id>/extraction-pass<n>.json, which pass 2 merges onto.

Container: `python main.py` with cwd /app (./worker), so imports are `extract` and `validate`; rules sits at
/app/rules. From the repo root the same modules are `worker.extract` / `worker.validate`.
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


def _validate_api():
    """(mark_extracting, handle_extraction, mark_failed) from worker/validate (Rules agent), or None when the
    adapter is not importable yet. In the container the module is `validate` (cwd /app); from the repo root it
    is `worker.validate`."""
    for mod in ("validate", "worker.validate"):
        try:
            m = __import__(mod, fromlist=["handle_extraction"])
            return m.mark_extracting, m.handle_extraction, m.mark_failed
        except (ImportError, AttributeError):
            continue
    return None


def handle(job: dict, api=None):
    """One job: mark extracting -> extract -> write extraction-pass<n>.json -> validate.handle_extraction.
    Any exception from extraction or the hand-off marks the upload failed (and is re-raised for the log).
    Returns handle_extraction's result, or the extraction itself when the adapter is not available."""
    upload_id = job["upload_id"]
    api = api if api is not None else _validate_api()
    if api is None:
        log.warning("validate adapter not importable; extracting %s without database hand-off", upload_id)
    else:
        api[0](upload_id)
    try:
        extraction = run_job(job)
        folder = upload_dir(upload_id)
        folder.mkdir(parents=True, exist_ok=True)
        out = folder / f"extraction-pass{extraction['meta']['pass']}.json"
        out.write_text(json.dumps(extraction, indent=1), encoding="utf-8")   # pass 2 reads pass 1 from here
        log.info("extracted %s pass %s -> %s (unplaced: %s)", upload_id, extraction["meta"]["pass"], out,
                 extraction["meta"].get("unplaced"))
        if api is None:
            return extraction
        result = api[1](job, extraction)
        log.info("handed off %s: %s", upload_id, result)
        return result
    except Exception as exc:
        log.exception("job failed: %s", job)
        if api is not None:
            try:
                api[2](upload_id, str(exc))
            except Exception:
                log.exception("mark_failed failed for %s", upload_id)
        raise


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
                pass    # already logged and marked failed in handle()
