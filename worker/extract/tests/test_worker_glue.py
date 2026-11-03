"""worker/main.py run_job: pass 1 from FILE_STORE/uploads/<id>/source.pdf; pass 2 merges onto the pass-1 file."""
import json
import shutil

from worker.main import handle, run_job

from .conftest import SAMPLES, needs_samples

pytestmark = needs_samples
UID = "11111111-1111-4111-8111-111111111111"


def test_pass1_then_pass2(tmp_path, monkeypatch):
    folder = tmp_path / "uploads" / UID
    folder.mkdir(parents=True)
    shutil.copy(SAMPLES / "Stride Capital - 202608 - SETTREP.pdf", folder / "source.pdf")
    monkeypatch.setenv("FILE_STORE", str(tmp_path))
    ex1 = handle({"upload_id": UID, "pass": 1})
    assert ex1["meta"]["upload_id"] == UID and (folder / "extraction-pass1.json").exists()
    ex2 = run_job({"upload_id": UID, "pass": 2, "pages": [2]})
    assert ex2["meta"]["pass"] == 2 and ex2["meta"]["pages_reread"] == [2]
    assert ex2["deal"]["covenants"] == json.loads((folder / "extraction-pass1.json").read_text())["deal"]["covenants"]
