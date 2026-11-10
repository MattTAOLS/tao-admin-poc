"""Queue consumer. Job = {"upload_id": ..., "pass": 1|2, "pages": [...], "template_id"?: ...}.
Flow: load PDF -> extract/ (text layer, OCR fallback later) -> validate/ (rules package) -> write extraction +
findings -> set upload status.

The Extraction agent owns the extract step (`run_job`). Every database write belongs to the adapter in
worker/validate/ (Rules agent): mark_extracting(upload_id), handle_extraction(job, extraction) (extraction row,
rules, findings, pass-2 queueing, needs_review) and mark_failed(upload_id, error). The extraction is also
written as FILE_STORE/uploads/<id>/extraction-pass<n>.json, which pass 2 merges onto.

Container: `python main.py` with cwd /app (./worker), so imports are `extract` and `validate`; rules sits at
/app/rules. From the repo root the same modules are `worker.extract` / `worker.validate`.

Lost jobs: BLPOP removes a job from the queue before the work starts, so a worker killed mid-job leaves its upload in
`extracting` with nothing to finish it. `recover()` (at start and every RECOVER_EVERY seconds, between jobs) asks the
adapter to fail every upload left in received / extracting with no job waiting for it and no activity for
WORKER_STALE_MINUTES (default 15): the operator sees extraction_failed with the reason and re-extracts. A Redis or
database error in the loop is logged and retried; it never ends the process.
"""
import inspect
import json
import logging
import os
import time
from pathlib import Path

try:                                   # in the container the worker folder is the working directory
    from extract import DEFAULT_TEMPLATE, extract, merge_patch
    from extract.history import extend
except ImportError:                    # from the repo root: python -m worker.main
    from worker.extract import DEFAULT_TEMPLATE, extract, merge_patch
    from worker.extract.history import extend

log = logging.getLogger("worker")
QUEUE = "extract:jobs"
RECOVER_EVERY = 120      # seconds between checks for uploads whose job was lost
RETRY_SECONDS = 5        # wait after a Redis / database error before trying again
MAX_ATTEMPTS = 5         # times a job is put back when the database could not be reached to start it


class JobNotStarted(RuntimeError):
    """The upload could not be marked as extracting (database unreachable): nothing was done, the job can be re-queued."""


def upload_dir(upload_id: str, file_store: str | None = None) -> Path:
    return Path(file_store or os.environ.get("FILE_STORE", "/data")) / "uploads" / upload_id


def run_job(job: dict, file_store: str | None = None, base: dict | None = None) -> dict:
    """Extract one job. Pass 2 re-reads `pages` and, given the pass-1 extraction as `base` (or found on disk),
    returns the merged full extraction (meta.pass = 2).
    A pass-2 job with no pass-1 extraction to merge onto (a re-extract of an upload whose first extraction failed, so
    extraction-pass1.json was never written) or with no pages runs a full pass 1 instead: a page patch on its own is
    a fragment, not an extraction. The result then says meta.pass = 1 and `handle` hands it off as pass 1."""
    upload_id = job["upload_id"]
    folder = upload_dir(upload_id, file_store)
    pdf = folder / "source.pdf"
    template_id = job.get("template_id") or DEFAULT_TEMPLATE
    if int(job.get("pass", 1)) == 2:
        pages = [int(p) for p in job.get("pages") or []]
        if base is None and (folder / "extraction-pass1.json").exists():
            base = json.loads((folder / "extraction-pass1.json").read_text(encoding="utf-8"))
        if not base or not isinstance(base.get("deal"), dict) or not pages:
            log.info("pass-2 job for %s without %s: running a full pass 1", upload_id,
                     "pages" if base else "a pass-1 extraction to merge onto")
            return extract(str(pdf), template_id, upload_id=upload_id)
        patch = extract(str(pdf), template_id, pages=pages, upload_id=upload_id)
        return merge_patch(base, patch)
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


def _accepts_extend(fn) -> bool:
    try:
        ps = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False
    return "extend" in ps or any(p.kind is inspect.Parameter.VAR_KEYWORD for p in ps.values())


def _hand_off(handle_extraction, job: dict, extraction: dict):
    """The adapter chains the extraction onto the deal's last published object with history.extend before it
    validates (one month at a time). Older adapters without the `extend` keyword get the plain call."""
    if _accepts_extend(handle_extraction):
        return handle_extraction(job, extraction, extend=extend)
    return handle_extraction(job, extraction)


def handle(job: dict, api=None):
    """One job: mark extracting -> extract -> write extraction-pass<n>.json -> validate.handle_extraction.
    Any exception from extraction or the hand-off marks the upload failed (and is re-raised for the log).
    Returns handle_extraction's result, or the extraction itself when the adapter is not available."""
    upload_id = job["upload_id"]
    api = api if api is not None else _validate_api()
    if api is None:
        log.warning("validate adapter not importable; extracting %s without database hand-off", upload_id)
    else:
        try:
            api[0](upload_id)
        except Exception as exc:       # database unreachable: nothing done yet, the caller may put the job back
            raise JobNotStarted(f"could not mark {upload_id} as extracting: {type(exc).__name__}: {exc}") from exc
    try:
        extraction = run_job(job)
        if int(job.get("pass", 1)) != extraction["meta"]["pass"]:
            # a pass-2 job that ran as a full pass 1 (run_job): store and validate it as the pass it is
            job = {k: v for k, v in job.items() if k != "pages"} | {"pass": extraction["meta"]["pass"]}
        folder = upload_dir(upload_id)
        folder.mkdir(parents=True, exist_ok=True)
        out = folder / f"extraction-pass{extraction['meta']['pass']}.json"
        out.write_text(json.dumps(extraction, indent=1), encoding="utf-8")   # pass 2 reads pass 1 from here
        log.info("extracted %s pass %s -> %s (unplaced: %s)", upload_id, extraction["meta"]["pass"], out,
                 extraction["meta"].get("unplaced"))
        if api is None:
            return extraction
        result = _hand_off(api[1], job, extraction)
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


def _recover_api():
    """validate.recover_stale, or None when the adapter (or that function) is not importable."""
    for mod in ("validate", "worker.validate"):
        try:
            return __import__(mod, fromlist=["recover_stale"]).recover_stale
        except (ImportError, AttributeError):
            continue
    return None


def queued_upload_ids(r) -> set:
    """Upload ids of the jobs still waiting in the queue (a job that does not parse is skipped here; `step` drops it)."""
    ids = set()
    for raw in r.lrange(QUEUE, 0, -1):
        try:
            ids.add(str(json.loads(raw)["upload_id"]))
        except (ValueError, TypeError, KeyError):
            continue
    return ids


def recover(r, recover_stale=None) -> list:
    """Fail uploads whose job was lost (see the module docstring). Returns the upload ids failed."""
    recover_stale = recover_stale if recover_stale is not None else _recover_api()
    if recover_stale is None:
        return []
    failed = recover_stale(queued_ids=queued_upload_ids(r))
    if failed:
        log.warning("uploads left without a job, marked extraction_failed: %s", failed)
    return failed


def step(r, handle_job=None, timeout: int = 5):
    """Take one job off the queue and handle it. Returns "idle" (nothing waiting), "dropped" (not a job), "requeued"
    (the database could not be reached to start it: the job went back on the queue), "failed" (the job ran and
    failed: handle() logged it and marked the upload) or "done"."""
    item = r.blpop(QUEUE, timeout=timeout)
    if not item:
        return "idle"
    try:
        job = json.loads(item[1])
        if not isinstance(job, dict) or not job.get("upload_id"):
            raise ValueError("no upload_id")
    except (ValueError, TypeError) as exc:
        log.error("dropping a queue entry that is not a job (%s): %r", exc, item[1][:200])
        return "dropped"
    try:
        (handle_job or handle)(job)
        return "done"
    except JobNotStarted as exc:
        attempts = int(job.get("attempts", 0)) + 1
        if attempts >= MAX_ATTEMPTS:
            log.error("giving up on job after %s attempts (%s): %s", attempts, exc, job)   # recover() fails the upload later
            return "failed"
        log.warning("%s; job put back on the queue (attempt %s)", exc, attempts)
        r.rpush(QUEUE, json.dumps({**job, "attempts": attempts}))
        return "requeued"
    except Exception:
        return "failed"    # already logged and marked failed in handle()


def serve(r, *, handle_job=None, recover_stale=None, sleep=time.sleep, clock=time.monotonic, max_steps: int | None = None):
    """The worker loop. Nothing raised inside it ends the process: a Redis or database error is logged, the loop waits
    RETRY_SECONDS and carries on (redis-py reconnects on the next command). `max_steps` is for tests."""
    last_recover = None
    n = 0
    while max_steps is None or n < max_steps:
        n += 1
        try:
            if last_recover is None or clock() - last_recover >= RECOVER_EVERY:
                last_recover = clock()          # set first: a failing recover is retried on the next interval, not every loop
                recover(r, recover_stale)
            if step(r, handle_job) == "requeued":
                sleep(RETRY_SECONDS)
        except Exception:
            log.exception("worker loop error; retrying in %ss", RETRY_SECONDS)
            sleep(RETRY_SECONDS)


if __name__ == "__main__":
    import redis
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    r = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    print("worker up; waiting on", QUEUE, flush=True)
    serve(r)
