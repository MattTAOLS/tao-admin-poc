"""Bug-audit fixes in worker/main.py: M8 (the loop survives Redis / database errors, lost jobs are recovered) and
L7 (a pass-2 job with no pass-1 extraction to merge onto runs a full pass 1). Fakes only: no Redis, no database."""
import json
import shutil

import pytest

import worker.main as wm

from .conftest import SAMPLES, needs_samples

UID = "22222222-2222-4222-8222-222222222222"


class FakeRedis:
    def __init__(self, items=(), fail_times=0):
        self.items = [json.dumps(i) if not isinstance(i, (str, bytes)) else i for i in items]
        self.fail_times, self.calls = fail_times, 0

    def blpop(self, queue, timeout=0):
        self.calls += 1
        if self.fail_times:
            self.fail_times -= 1
            raise ConnectionError("redis down")
        if not self.items:
            return None
        raw = self.items.pop(0)
        return (queue.encode(), raw if isinstance(raw, bytes) else raw.encode())

    def lrange(self, queue, start, end):
        return [i if isinstance(i, bytes) else i.encode() for i in self.items]

    def rpush(self, queue, raw):
        self.items.append(raw)


# ---------- M8: the loop ----------
def test_m8_redis_error_is_logged_and_retried_not_fatal(caplog):
    r = FakeRedis([{"upload_id": UID, "pass": 1}], fail_times=2)
    handled, slept = [], []
    wm.serve(r, handle_job=handled.append, recover_stale=lambda queued_ids: [], sleep=slept.append, max_steps=4)
    assert handled == [{"upload_id": UID, "pass": 1}]          # taken after Redis came back
    assert slept == [wm.RETRY_SECONDS, wm.RETRY_SECONDS] and "worker loop error" in caplog.text


def test_m8_database_error_in_recover_does_not_end_the_loop(caplog):
    r = FakeRedis([{"upload_id": UID, "pass": 1}])
    handled = []

    def broken(queued_ids):
        raise RuntimeError("database down")
    wm.serve(r, handle_job=handled.append, recover_stale=broken, sleep=lambda s: None, max_steps=3)
    assert handled == [{"upload_id": UID, "pass": 1}] and "database down" in caplog.text


def test_m8_malformed_queue_entries_are_dropped(caplog):
    r = FakeRedis(["not json", json.dumps([1, 2]), json.dumps({"pass": 1}), {"upload_id": UID, "pass": 1}])
    handled = []
    assert [wm.step(r, handled.append) for _ in range(5)] == ["dropped", "dropped", "dropped", "done", "idle"]
    assert handled == [{"upload_id": UID, "pass": 1}]


def test_m8_job_goes_back_on_the_queue_when_the_upload_cannot_be_marked():
    """mark_extracting raising (database unreachable) used to escape the loop and end the process with the job gone."""
    def mark_extracting(upload_id):
        raise ConnectionError("db down")
    api = (mark_extracting, None, lambda upload_id, error: None)
    r = FakeRedis([{"upload_id": UID, "pass": 1}])
    assert wm.step(r, lambda job: wm.handle(job, api=api)) == "requeued"
    assert [json.loads(i) for i in r.items] == [{"upload_id": UID, "pass": 1, "attempts": 1}]
    for _ in range(wm.MAX_ATTEMPTS - 2):
        assert wm.step(r, lambda job: wm.handle(job, api=api)) == "requeued"
    assert wm.step(r, lambda job: wm.handle(job, api=api)) == "failed" and r.items == []      # recover() fails the upload later


def test_m8_a_failed_job_does_not_stop_the_loop():
    r = FakeRedis([{"upload_id": "a", "pass": 1}, {"upload_id": "b", "pass": 1}])
    seen = []

    def handle_job(job):
        seen.append(job["upload_id"])
        if job["upload_id"] == "a":
            raise RuntimeError("extraction failed")
    wm.serve(r, handle_job=handle_job, recover_stale=lambda queued_ids: [], sleep=lambda s: None, max_steps=3)
    assert seen == ["a", "b"]


def test_m8_recover_runs_at_start_and_on_the_interval_with_the_queued_ids():
    r = FakeRedis([{"upload_id": "queued-1", "pass": 1}, "junk"])
    calls, now = [], [0.0]

    def recover_stale(queued_ids):
        calls.append(set(queued_ids))
        return []

    def handle_job(job):
        now[0] += wm.RECOVER_EVERY + 1          # the job took longer than the interval
    wm.serve(r, handle_job=handle_job, recover_stale=recover_stale, sleep=lambda s: None, clock=lambda: now[0], max_steps=3)
    assert calls[0] == {"queued-1"} and len(calls) == 2 and calls[1] == set()


def test_m8_recover_reports_what_it_failed(caplog):
    r = FakeRedis()
    assert wm.recover(r, lambda queued_ids: ["u-1"]) == ["u-1"] and "u-1" in caplog.text


# ---------- L7 ----------
class FakeValidate:
    def __init__(self):
        self.events = []

    def mark_extracting(self, upload_id):
        self.events.append(("extracting", upload_id))

    def handle_extraction(self, job, extraction, extend=None):
        self.events.append(("handle", dict(job), extraction["meta"]["pass"]))
        return {"extraction_id": "e-1", "status": "needs_review", "counts": {"block": 0}}

    def mark_failed(self, upload_id, error):
        self.events.append(("failed", upload_id, error))

    @property
    def api(self):
        return self.mark_extracting, self.handle_extraction, self.mark_failed


@pytest.fixture
def store(tmp_path, monkeypatch):
    folder = tmp_path / "uploads" / UID
    folder.mkdir(parents=True)
    monkeypatch.setenv("FILE_STORE", str(tmp_path))
    return folder


@needs_samples
def test_l7_reextract_without_a_pass_1_file_runs_a_full_pass_1(store):
    """Re-extract from extraction_failed: the API queues pass 2 with pages, but no extraction-pass1.json exists.
    The stored extraction must be the whole report, handed off as pass 1, not the fragment for those pages."""
    shutil.copy(SAMPLES / "Stride Capital - 202608 - SETTREP.pdf", store / "source.pdf")
    fake = FakeValidate()
    wm.handle({"upload_id": UID, "pass": 2, "pages": [2], "template_id": "fpil-2.0-settrep-v1"}, api=fake.api)
    kind, job, pass_no = fake.events[-1]
    assert kind == "handle" and pass_no == 1 and job == {"upload_id": UID, "pass": 1, "template_id": "fpil-2.0-settrep-v1"}
    full = json.loads((store / "extraction-pass1.json").read_text(encoding="utf-8"))
    assert not (store / "extraction-pass2.json").exists()
    assert full["meta"]["pass"] == 1 and "pages_reread" not in full["meta"]
    assert full["deal"]["covenants"] and full["deal"]["aging_history"] and full["deal"]["deal_slug"] == "f-pil-2-0-stride-capital"
    # the next re-extract has a base and is a real pass 2
    wm.handle({"upload_id": UID, "pass": 2, "pages": [2]}, api=fake.api)
    assert fake.events[-1][2] == 2 and fake.events[-1][1]["pass"] == 2
    merged = json.loads((store / "extraction-pass2.json").read_text(encoding="utf-8"))
    assert merged["deal"] == full["deal"]


def test_l7_run_job_never_returns_a_bare_patch(store, monkeypatch):
    calls = []

    def fake_extract(pdf, template_id, pages=None, upload_id=None):
        calls.append(pages)
        return {"meta": {"pass": 2 if pages else 1}, "deal": {"x": 1}, "sources": {}}
    monkeypatch.setattr(wm, "extract", fake_extract)
    assert wm.run_job({"upload_id": UID, "pass": 2, "pages": [3]})["meta"]["pass"] == 1 and calls == [None]
    (store / "extraction-pass1.json").write_text("{}", encoding="utf-8")            # an unusable base is no base
    assert wm.run_job({"upload_id": UID, "pass": 2, "pages": [3]})["meta"]["pass"] == 1
    assert wm.run_job({"upload_id": UID, "pass": 2, "pages": []}, base={"meta": {}, "deal": {"x": 0}, "sources": {}})["meta"]["pass"] == 1
