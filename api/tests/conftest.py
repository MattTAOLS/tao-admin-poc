"""Test harness: SQLite file DB + temp file store, set before the app is imported; the repo root on sys.path so
`import rules` works as it does in compose (/app/rules). Every test starts from freshly seeded master data."""
import os, sys, json, pathlib, tempfile, io
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
TMP = pathlib.Path(tempfile.mkdtemp(prefix="tao-api-tests-"))
# TEST_DATABASE_URL=postgresql+psycopg://... runs the suite against PostgreSQL built from db/migrations/*.sql
# (the schema compose uses). The database's public schema is dropped and rebuilt, so point it at a throwaway.
PG = os.environ.get("TEST_DATABASE_URL")
os.environ["DATABASE_URL"] = PG or f"sqlite:///{(TMP / 'test.sqlite').as_posix()}"
os.environ["FILE_STORE"] = str(TMP / "store")
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import db, seed, jobs            # noqa: E402
from app.main import app                  # noqa: E402
from app.models import Base               # noqa: E402

if PG:
    from sqlalchemy import text
    with db.engine().begin() as conn:
        conn.execute(text("drop schema public cascade; create schema public"))
        for f in sorted((ROOT / "db" / "migrations").glob("*.sql")):
            conn.exec_driver_sql(f.read_text(encoding="utf-8"))
else:
    db.create_all()

TAO = {"X-Role": "tao_admin"}
ANALYST = {"X-Role": "tao_analyst"}
INV = {"X-Role": "investor_viewer", "X-Partner": "investor"}
MGR = {"X-Role": "manager_viewer", "X-Partner": "manager"}
REF = ROOT / "docs" / "dashboard-json"


@pytest.fixture(autouse=True)
def fresh_db():
    eng = db.engine()
    with eng.begin() as c:
        for t in reversed(Base.metadata.sorted_tables):
            c.execute(t.delete())
    with db.session() as s:
        seed.load(s)
    yield


@pytest.fixture(autouse=True)
def queue():
    q = jobs.ListQueue()
    app.dependency_overrides[jobs.get_queue] = lambda: q
    yield q
    app.dependency_overrides.pop(jobs.get_queue, None)


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    return TestClient(app)


def make_pdf(pages: int = 3) -> bytes:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument.new()
    for _ in range(pages):
        doc.new_page(612, 792)
    buf = io.BytesIO(); doc.save(buf)
    return buf.getvalue()


def reference_deal(slug: str) -> dict:
    return json.loads((REF / f"{slug}.dashboard.json").read_text(encoding="utf-8"))
