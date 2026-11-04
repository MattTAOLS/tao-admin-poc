"""PDFium is not thread-safe: concurrent first renders used to crash the server process (QA, wave 3).
Every render must go through the process-wide lock and land atomically."""
import io, threading
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from conftest import TAO, make_pdf
from test_uploads import upload
from app import pdf
from app.db import file_store


def _valid_png(data: bytes) -> bool:
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return False
    Image.open(io.BytesIO(data)).verify()
    return True


def test_concurrent_page_requests_all_return_valid_pngs(client):
    u = upload(client, pdf=make_pdf(8)).json()
    urls = [f"/api/v1/uploads/{u['id']}/pages/{n}.png" for n in range(3, 9) for _ in range(3)]       # 18 requests, 6 pages
    barrier = threading.Barrier(len(urls))

    def get(url):
        barrier.wait()
        return client.get(url, headers=TAO)

    with ThreadPoolExecutor(max_workers=len(urls)) as ex:
        responses = list(ex.map(get, urls))
    assert [r.status_code for r in responses] == [200] * len(urls)
    assert all(_valid_png(r.content) for r in responses)
    pages = file_store() / "uploads" / u["id"] / "pages"
    assert sorted(p.name for p in pages.iterdir()) == [f"{n}.png" for n in range(3, 9)]                  # no temp files left
    assert client.get("/api/v1/health").status_code == 200


def test_render_function_from_many_threads(tmp_path):
    src = tmp_path / "source.pdf"; src.write_bytes(make_pdf(6))
    jobs = [(n, tmp_path / "pages" / f"{n}.png") for n in range(1, 7) for _ in range(4)] + [(None, None)] * 8
    barrier = threading.Barrier(len(jobs))

    def work(job):
        n, dest = job
        barrier.wait()
        if n is None:                               # page counting runs under the same lock
            return pdf.page_count(src.read_bytes())
        return pdf.render_page(src, n, dest, 110).read_bytes()

    with ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        out = list(ex.map(work, jobs))
    assert out[-8:] == [6] * 8
    assert all(_valid_png(b) for b in out[:-8])
    assert sorted(p.name for p in (tmp_path / "pages").iterdir()) == [f"{n}.png" for n in range(1, 7)]


def test_failed_render_leaves_no_temp_file(tmp_path):
    src = tmp_path / "source.pdf"; src.write_bytes(make_pdf(1))
    try:
        pdf.render_page(src, 5, tmp_path / "pages" / "5.png", 110)
    except Exception:
        pass
    assert list((tmp_path / "pages").iterdir()) == []
