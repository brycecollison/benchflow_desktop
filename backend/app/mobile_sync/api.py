"""The phone's way in: a second FastAPI app on a fixed 127.0.0.1 port, published to the tailnet with
`tailscale serve` (never `funnel`). Only the sync surface is here - no backup, update, reset or
whole-state endpoints - and every call but /health and /pair needs a device bearer token, because
requests through `tailscale serve` arrive from localhost and the window API trusts localhost.

Dev: `python -m uvicorn app.mobile_sync.api:app --port 18766` from backend/.
"""

import base64
import binascii
import hashlib
import os
import re
from typing import Any, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.database import DB_PATH, get_session
from app.db_service import changes_since, get_device_id
from app.image_processor import process_uploaded_file
from app.mobile_sync import service
from app.paths import UPLOAD_DIR

SYNC_PORT = int(os.environ.get("BENCHFLOW_SYNC_PORT", "18766"))  # 0: do not start

app = FastAPI(title="Benchflow mobile sync", docs_url=None, redoc_url=None, openapi_url=None)


def device(authorization: str = Header(""), session: Session = Depends(get_session)) -> str:
    token = authorization[len("Bearer "):].strip() if authorization.startswith("Bearer ") else ""
    device_id = service.device_for_token(session, token) if token else None
    if not device_id:
        raise HTTPException(status_code=401, detail="Unknown or revoked device; pair again from Settings")
    return device_id


@app.get("/api/mobile/health")
def health():
    return {"service": "benchflow-sync"}


class PairRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    device_id: str = Field(min_length=1, max_length=64)
    name: str = Field(default="Phone", max_length=100)


@app.post("/api/mobile/pair")
def pair(req: PairRequest, session: Session = Depends(get_session)):
    token = service.pair(session, req.code, req.device_id, req.name)
    if token is None:
        raise HTTPException(status_code=401, detail="Pairing code is wrong or expired")
    return {"token": token, "desktop_id": get_device_id(session)}


@app.get("/api/mobile/changes")
def changes(since: int = 0, _device: str = Depends(device), session: Session = Depends(get_session)):
    return changes_since(session, since)


class Op(BaseModel):
    op_id: str = Field(min_length=1, max_length=64)
    experiment_id: str = Field(min_length=1, max_length=128)
    unit: str = Field(min_length=1, max_length=256)
    base_value: Any = None
    new_value: Any = None
    at: str = ""
    base_rev: Optional[int] = None


class OpBatch(BaseModel):
    ops: List[Op] = Field(max_length=500)


@app.post("/api/mobile/ops")
def push_ops(batch: OpBatch, device_id: str = Depends(device), session: Session = Depends(get_session)):
    return service.apply_ops(session, device_id, [o.model_dump() for o in batch.ops], DB_PATH)


_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def upload_name(digest_hex: str, filename: str) -> str:
    """Content-addressed: the phone computes the same name before uploading (mobile/src/repo.ts),
    so a photo's /uploads/ link is valid on both sides from the moment it is taken."""
    original = filename.replace("\\", "/").rsplit("/", 1)[-1]
    return f"{digest_hex[:16]}_{_SAFE_NAME.sub('_', original)[-120:] or 'upload'}"


class UploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    data: str = Field(max_length=40_000_000)  # base64; the phone downscales photos first


@app.post("/api/mobile/uploads")
def upload(req: UploadRequest, _device: str = Depends(device)):
    """JSON + base64, not multipart: the phone's native HTTP sends strings. Content-addressed, so a
    retried upload lands on the same name and is stored once."""
    try:
        raw = base64.b64decode(req.data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="data is not base64")
    name = upload_name(hashlib.sha256(raw).hexdigest(), req.filename)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target = UPLOAD_DIR / name
    if not target.exists():
        staged = UPLOAD_DIR / f".mobile-{os.urandom(8).hex()}.part"
        staged.write_bytes(raw)
        staged.replace(target)
    preview_url, metadata = process_uploaded_file(target, UPLOAD_DIR)
    raw_url = f"/uploads/{name}"
    return {"filename": req.filename, "url": preview_url or raw_url, "preview_url": preview_url,
            "raw_url": raw_url, "size": len(raw), "metadata": metadata or None}


class ResolveRequest(BaseModel):
    choice: str = Field(pattern="^(keep|other)$")


@app.get("/api/mobile/conflicts")
def conflicts(_device: str = Depends(device), session: Session = Depends(get_session)):
    return service.list_conflicts(session)


@app.post("/api/mobile/conflicts/{conflict_id}/resolve")
def resolve(conflict_id: str, req: ResolveRequest, device_id: str = Depends(device),
            session: Session = Depends(get_session)):
    if not service.resolve_conflict(session, conflict_id, req.choice, device_id):
        raise HTTPException(status_code=404, detail="No such open conflict")
    return {"status": "resolved"}


@app.get("/api/mobile/uploads/{name:path}")
def download(name: str, _device: str = Depends(device)):
    path = (UPLOAD_DIR / name).resolve()
    if not path.is_relative_to(UPLOAD_DIR.resolve()) or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path)
