"""Load demo state into a running API through its HTTP routes (the worker must be running). Uses only the real
SetRep PDFs in data/samples/; the one seeded error is a copy of Moneda 202608 with one digit changed on page 2
(scheduled principal 646,926.71 -> 646,826.71, so R05 fails by exactly -100.00).

Seed master data first:   docker compose -p <project> -f docker-compose.yml -f scripts/compose.agent.yml exec api python -m app.seed
Partner profile instead:  ... exec api python -m app.seed --reference-publications   (all 12 reference deals published; no uploads)

Profiles:
Approving accepts R11 restatement findings first (Xpedite revises earlier months in Jun-Aug, as the reference
object's `restatements` record); any other open block finding stops the approval and is printed.

  admin   F-PIL May-Jul approved for all three deals, Moneda Aug approved, Stride and Xpedite Aug left in needs_review.
  review  Moneda May-Jul approved and the seeded Moneda Aug left in needs_review (one R05 block on page 2);
          Xpedite May-Aug approved; Stride Aug left in needs_review.

  python scripts/demo_data.py --api http://localhost:18100 --profile admin
"""
import argparse
import io
import pathlib
import sys
import time

import httpx

ROOT = pathlib.Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "data" / "samples"
TAO = {"X-Role": "tao_admin"}
DEALS = {
    "moneda": ("f-pil-2-0-moneda-capital-corp", "Moneda-{m} -SETTREP.pdf"),
    "stride": ("f-pil-2-0-stride-capital", "Stride Capital - {m} - SETTREP.pdf"),
    "xpedite": ("f-pil-2-0-xpedite-leasing", "Xpedite Leasing - {m} - SETTREP.pdf"),
}
SEED_ORIGINAL = b"[(6)-3(4)-3(6)-3(,)6(9)-3(2)-3(6)-3(.)8(7)-3(1)] TJ"
SEED_CHANGED = b"[(6)-3(4)-3(6)-3(,)6(8)-3(2)-3(6)-3(.)8(7)-3(1)] TJ"


def seeded_moneda_aug() -> bytes:
    import pypdf
    writer = pypdf.PdfWriter(clone_from=pypdf.PdfReader(str(SAMPLES / "Moneda-202608 -SETTREP.pdf")))
    page = writer.pages[1]
    contents = page.get_contents()
    data = contents.get_data()
    if data.count(SEED_ORIGINAL) != 1:
        sys.exit("Moneda 202608 page 2 changed; update SEED_ORIGINAL")
    contents.set_data(data.replace(SEED_ORIGINAL, SEED_CHANGED))
    page.replace_contents(contents)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def upload(c: httpx.Client, deal: str, yyyymm: str, approve: bool, pdf: bytes | None = None) -> dict:
    slug, pattern = DEALS[deal]
    name = pattern.format(m=yyyymm)
    body = pdf if pdf is not None else (SAMPLES / name).read_bytes()
    r = c.post("/uploads", headers=TAO, data={"deal_slug": slug, "collection_period": f"{yyyymm[:4]}-{yyyymm[4:]}"},
               files={"file": (name, body, "application/pdf")})
    if r.status_code == 409:
        print(f"  {deal} {yyyymm}: already there ({r.json().get('code')})")
        return {}
    r.raise_for_status()
    uid = r.json()["id"]
    t0 = time.time()
    while True:
        u = c.get(f"/uploads/{uid}", headers=TAO).json()
        if u["status"] not in ("received", "extracting") or time.time() - t0 > 240:
            break
        time.sleep(1)
    line = f"  {deal} {yyyymm}: {u['status']} {u.get('finding_counts')}"
    if approve and u["status"] == "needs_review":
        # The servicer revising an earlier month (R11 restatement) is real: accept it as a reviewer would.
        findings = c.get(f"/uploads/{uid}/findings", headers=TAO).json()
        for f in findings if isinstance(findings, list) else findings.get("items", []):
            if f["status"] == "open" and (f.get("context") or {}).get("restatement"):
                c.post(f"/uploads/{uid}/findings/{f['id']}/override", headers=TAO,
                       json={"choice": "restatement", "reason": "servicer revised an earlier month; matches the reference restatements"}).raise_for_status()
                line += f" [restatement {f['context'].get('field')} {f['context'].get('month')} accepted]"
        a = c.post(f"/uploads/{uid}/approve", headers=TAO, json={})
        line += f" -> approve {a.status_code} {a.json().get('code', '') if a.status_code != 200 else 'published'}"
    print(line)
    return u


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:18000")
    ap.add_argument("--profile", choices=["admin", "review"], required=True)
    a = ap.parse_args()
    c = httpx.Client(base_url=a.api.rstrip("/") + "/api/v1", timeout=60)
    c.get("/health").raise_for_status()
    if a.profile == "admin":
        for m in ("202605", "202606", "202607"):
            for d in DEALS:
                upload(c, d, m, approve=True)
        upload(c, "moneda", "202608", approve=True)
        upload(c, "stride", "202608", approve=False)
        upload(c, "xpedite", "202608", approve=False)
    else:
        for m in ("202605", "202606", "202607"):
            upload(c, "moneda", m, approve=True)
        for m in ("202605", "202606", "202607", "202608"):
            upload(c, "xpedite", m, approve=True)
        upload(c, "moneda", "202608", approve=False, pdf=seeded_moneda_aug())
        upload(c, "stride", "202608", approve=False)


if __name__ == "__main__":
    main()
