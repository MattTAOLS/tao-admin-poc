"""FastAPI skeleton. Routes exist and enforce roles; the Data & API agent fills in persistence.
Every route in contracts/openapi.yaml must exist here by gate G1 (even if it returns a stub)."""
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from .auth import caller, tao_only, admin_only, Caller
import uuid, datetime as dt

app = FastAPI(title="TAO Admin POC API", version="0.1.0", openapi_url="/api/v1/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
API = "/api/v1"
NOT_BUILT = {"code": "not_built", "message": "stub: owned by the Data & API agent"}

@app.get(API + "/health")
def health(): return {"ok": True, "at": dt.datetime.now(dt.timezone.utc).isoformat()}

# ---- uploads (TAO) ----
@app.post(API + "/uploads", status_code=201)
async def create_upload(deal_slug: str = Form(...), collection_period: str = Form(...), file: UploadFile = File(...), c: Caller = Depends(caller)):
    tao_only(c)
    return {"id": str(uuid.uuid4()), "deal_slug": deal_slug, "program_slug": "tbd", "partner_slug": "tbd", "collection_period": collection_period,
            "reporting_period": None, "status": "received", "file_name": file.filename, "page_count": None, "uploaded_by": c.role,
            "uploaded_at": dt.datetime.now(dt.timezone.utc).isoformat(), "finding_counts": {"block": 0, "review": 0, "note": 0},
            "latest_extraction_id": None, "published_at": None}

@app.get(API + "/uploads")
def list_uploads(status: str | None = None, deal_slug: str | None = None, c: Caller = Depends(caller)):
    tao_only(c); return []

@app.get(API + "/uploads/{upload_id}")
def get_upload(upload_id: str, c: Caller = Depends(caller)):
    tao_only(c); raise HTTPException(404, {"code": "not_found", "message": "no such upload"})

@app.get(API + "/uploads/{upload_id}/extraction")
def get_extraction(upload_id: str, c: Caller = Depends(caller)):
    tao_only(c); raise HTTPException(404, NOT_BUILT)

@app.get(API + "/uploads/{upload_id}/findings")
def get_findings(upload_id: str, c: Caller = Depends(caller)):
    tao_only(c); return []

@app.post(API + "/uploads/{upload_id}/findings/{finding_id}/override")
def override(upload_id: str, finding_id: str, body: dict, c: Caller = Depends(caller)):
    admin_only(c); raise HTTPException(501, NOT_BUILT)

@app.post(API + "/uploads/{upload_id}/reextract", status_code=202)
def reextract(upload_id: str, body: dict, c: Caller = Depends(caller)):
    tao_only(c); raise HTTPException(501, NOT_BUILT)

@app.post(API + "/uploads/{upload_id}/approve")
def approve(upload_id: str, c: Caller = Depends(caller)):
    admin_only(c); raise HTTPException(501, NOT_BUILT)

@app.post(API + "/uploads/{upload_id}/reject")
def reject(upload_id: str, body: dict, c: Caller = Depends(caller)):
    admin_only(c); raise HTTPException(501, NOT_BUILT)

@app.get(API + "/uploads/{upload_id}/pages/{n}.png")
def page_image(upload_id: str, n: int, c: Caller = Depends(caller)):
    tao_only(c); raise HTTPException(501, NOT_BUILT)

@app.get(API + "/uploads/{upload_id}/file")
def get_file(upload_id: str, c: Caller = Depends(caller)):
    tao_only(c); raise HTTPException(501, NOT_BUILT)

# ---- master data (TAO) ----
@app.get(API + "/master/programs")
def programs(c: Caller = Depends(caller)): tao_only(c); return []
@app.put(API + "/master/programs")
def put_program(body: dict, c: Caller = Depends(caller)): admin_only(c); raise HTTPException(501, NOT_BUILT)
@app.get(API + "/master/deals")
def deals(program_slug: str | None = None, c: Caller = Depends(caller)): tao_only(c); return []
@app.put(API + "/master/deals")
def put_deal(body: dict, c: Caller = Depends(caller)): admin_only(c); raise HTTPException(501, NOT_BUILT)
@app.get(API + "/master/covenants")
def covenants(deal_slug: str | None = None, as_of: str | None = None, c: Caller = Depends(caller)): tao_only(c); return []
@app.put(API + "/master/covenants")
def put_covenant(body: dict, c: Caller = Depends(caller)): admin_only(c); raise HTTPException(501, NOT_BUILT)

# ---- published views (all roles, partner-filtered) ----
def partner_filter(c: Caller) -> str | None:
    """TAO sees everything; a partner role sees only its own partner. ONE place, used by every published route."""
    return None if c.is_tao else c.partner

@app.get(API + "/published/portfolio")
def published_portfolio(c: Caller = Depends(caller)):
    return {"partner": partner_filter(c), "programs": [], "note": NOT_BUILT["message"]}

@app.get(API + "/published/programs/{program_slug}")
def published_program(program_slug: str, period: str | None = None, c: Caller = Depends(caller)):
    raise HTTPException(404, {"code": "not_found", "message": "nothing published yet"})

@app.get(API + "/published/programs/{program_slug}/deals/{deal_slug}")
def published_deal(program_slug: str, deal_slug: str, period: str | None = None, c: Caller = Depends(caller)):
    raise HTTPException(404, {"code": "not_found", "message": "nothing published yet"})

@app.post(API + "/published/regenerate", status_code=202)
def regenerate(body: dict | None = None, c: Caller = Depends(caller)):
    admin_only(c); return {"queued": True}

@app.get(API + "/audit")
def audit(upload_id: str | None = None, c: Caller = Depends(caller)):
    admin_only(c); return []
