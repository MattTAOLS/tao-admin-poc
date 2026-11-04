import glob
import os
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# EXTRACT_SAMPLES_DIR points other worktrees at a checkout that has the (git-ignored) samples
SAMPLES = pathlib.Path(os.environ.get("EXTRACT_SAMPLES_DIR") or ROOT / "data" / "samples")
MOVE_SAMPLES = SAMPLES / "move-trust"
REFS = ROOT / "docs" / "dashboard-json"

# deal slug -> file-name prefix of its SetReps in data/samples (git-ignored; the Lead places them there)
DEALS = {
    "f-pil-2-0-moneda-capital-corp": "Moneda",
    "f-pil-2-0-stride-capital": "Stride",
    "f-pil-2-0-xpedite-leasing": "Xpedite",
}


def sample_pdfs(prefix: str) -> list[str]:
    return sorted(glob.glob(str(SAMPLES / f"{prefix}*.pdf")))


needs_samples = pytest.mark.skipif(not glob.glob(str(SAMPLES / "*.pdf")),
                                   reason="sample SetReps not present under data/samples/")


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: long sample runs (MOVE Trust); run with EXTRACT_ALL=1")


def pytest_collection_modifyitems(config, items):
    if os.environ.get("EXTRACT_ALL") == "1":
        return
    skip = pytest.mark.skip(reason="slow sample test; set EXTRACT_ALL=1 to run")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip)
