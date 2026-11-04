"""Every PDFium call in the API goes through here. PDFium is not thread-safe, and FastAPI runs sync routes on a thread
pool: concurrent renders crashed the uvicorn process with no log line (QA, wave 3). One process-wide lock serialises
every open, render and save. Rendered pages are written to a temp file in the same folder and moved into place with
os.replace, so concurrent requests for one page never serve a half-written PNG."""
import os, pathlib, tempfile, threading

PDFIUM_LOCK = threading.Lock()


def page_count(data: bytes) -> int:
    """Raises on anything that is not a readable PDF."""
    import pypdfium2 as pdfium
    with PDFIUM_LOCK:
        doc = pdfium.PdfDocument(data)
        try:
            return len(doc)
        finally:
            doc.close()


def render_page(src: pathlib.Path, n: int, dest: pathlib.Path, dpi: int) -> pathlib.Path:
    """Render page n (1-based) of src to dest as PNG, unless dest already exists. Safe to call from many threads."""
    if dest.exists():
        return dest
    import pypdfium2 as pdfium
    dest.parent.mkdir(parents=True, exist_ok=True)
    with PDFIUM_LOCK:
        if dest.exists():                         # another thread rendered it while we waited
            return dest
        fd, tmp = tempfile.mkstemp(prefix=f".{dest.stem}-", suffix=".png.tmp", dir=dest.parent)
        fh = os.fdopen(fd, "wb")
        try:
            doc = pdfium.PdfDocument(str(src))
            try:
                image = doc[n - 1].render(scale=dpi / 72).to_pil()
            finally:
                doc.close()
            with fh:
                image.save(fh, format="PNG")
            os.replace(tmp, dest)
        except BaseException:
            fh.close()                            # Windows cannot unlink an open file
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    return dest
