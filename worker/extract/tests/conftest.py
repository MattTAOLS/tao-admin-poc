import glob
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SAMPLES = ROOT / "data" / "samples"
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
