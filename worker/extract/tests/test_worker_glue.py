"""worker/main.py: run_job (pass 1 from FILE_STORE/uploads/<id>/source.pdf, pass 2 merged onto the pass-1 file)
and handle()'s hand-off to the validate adapter (mark_extracting / handle_extraction / mark_failed), with fakes."""
import json
import os
import shutil
import subprocess
import sys

import pytest

import worker.main as wm
from worker.main import handle, run_job

from .conftest import ROOT, SAMPLES, needs_samples

UID = "11111111-1111-4111-8111-111111111111"


class FakeValidate:
    def __init__(self, fail_on_handoff=False):
        self.events, self.fail_on_handoff = [], fail_on_handoff

    def mark_extracting(self, upload_id):
        self.events.append(("extracting", upload_id))

    def handle_extraction(self, job, extraction):
        self.events.append(("handle", job["upload_id"], extraction["meta"]["pass"]))
        if self.fail_on_handoff:
            raise RuntimeError("db down")
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
def test_success_path_then_pass2(store, monkeypatch):
    shutil.copy(SAMPLES / "Stride Capital - 202608 - SETTREP.pdf", store / "source.pdf")
    fake = FakeValidate()
    monkeypatch.setattr(wm, "_validate_api", lambda: fake.api)
    res = handle({"upload_id": UID, "pass": 1})
    assert res == {"extraction_id": "e-1", "status": "needs_review", "counts": {"block": 0}}
    assert fake.events == [("extracting", UID), ("handle", UID, 1)]
    pass1 = json.loads((store / "extraction-pass1.json").read_text(encoding="utf-8"))
    assert pass1["meta"]["upload_id"] == UID

    # pass 2: re-reads page 2, merges onto the pass-1 file, hands the full extraction off
    handle({"upload_id": UID, "pass": 2, "pages": [2]})
    assert fake.events[-1] == ("handle", UID, 2)
    ex2 = json.loads((store / "extraction-pass2.json").read_text(encoding="utf-8"))
    assert ex2["meta"]["pass"] == 2 and ex2["meta"]["pages_reread"] == [2]
    assert ex2["deal"]["covenants"] == pass1["deal"]["covenants"]
    assert run_job({"upload_id": UID, "pass": 2, "pages": [2]})["deal"] == ex2["deal"]


def test_failure_in_extraction_marks_failed(store, monkeypatch):
    fake = FakeValidate()
    monkeypatch.setattr(wm, "_validate_api", lambda: fake.api)
    with pytest.raises(Exception):
        handle({"upload_id": UID, "pass": 1})          # no source.pdf in the store
    assert fake.events[0] == ("extracting", UID)
    assert fake.events[-1][0] == "failed" and fake.events[-1][1] == UID and fake.events[-1][2]
    assert not any(e[0] == "handle" for e in fake.events)


def test_failure_in_pass2_without_pages_marks_failed(store, monkeypatch):
    fake = FakeValidate()
    monkeypatch.setattr(wm, "_validate_api", lambda: fake.api)
    with pytest.raises(ValueError):
        handle({"upload_id": UID, "pass": 2})
    assert fake.events[-1] == ("failed", UID, "pass-2 job without pages")


@needs_samples
def test_failure_in_handoff_marks_failed(store, monkeypatch):
    shutil.copy(SAMPLES / "Stride Capital - 202608 - SETTREP.pdf", store / "source.pdf")
    fake = FakeValidate(fail_on_handoff=True)
    monkeypatch.setattr(wm, "_validate_api", lambda: fake.api)
    with pytest.raises(RuntimeError):
        handle({"upload_id": UID, "pass": 1})
    assert fake.events == [("extracting", UID), ("handle", UID, 1), ("failed", UID, "db down")]
    assert (store / "extraction-pass1.json").exists()


@needs_samples
def test_without_adapter_extraction_is_kept_on_disk(store, monkeypatch):
    shutil.copy(SAMPLES / "Stride Capital - 202608 - SETTREP.pdf", store / "source.pdf")
    monkeypatch.setattr(wm, "_validate_api", lambda: None)
    ex = handle({"upload_id": UID, "pass": 1})
    assert ex["meta"]["upload_id"] == UID and (store / "extraction-pass1.json").exists()


def test_container_imports_without_worker_prefix():
    """`python main.py` from /app: main, extract and (when present) validate import as top-level modules,
    with rules/ and contracts/ beside them as in docker-compose."""
    code = ("import sys; sys.path.insert(0, '.'); import main; import extract; "
            "from extract import extract as fn, merge_patch; from extract.mapper import load_template; "
            "load_template('fpil-2.0-settrep-v1'); "
            "assert main.extract is fn; print('ok')")
    env = dict(os.environ, PYTHONPATH="")
    r = subprocess.run([sys.executable, "-c", code], cwd=ROOT / "worker", env=env, capture_output=True, text=True)
    assert r.returncode == 0 and "ok" in r.stdout, r.stderr
    # nothing under worker/ (outside tests) imports through the `worker.` prefix except main's documented fallback
    offenders = []
    for p in (ROOT / "worker").rglob("*.py"):
        if "tests" in p.parts:
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if (s.startswith("from worker.") or s.startswith("import worker")) and p.name != "main.py":
                offenders.append(f"{p.name}: {s}")
    assert offenders == []
