"""Web chatbot API - session-based, structured card responses."""

import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from app.models.web_chat_session import WebChatSession
from app.services.web_conversation import create_session, handle_message
from app.routers.auth import get_optional_user

router = APIRouter()

_MEDIA_ROOT = Path("/app/media")
_CHAT_UPLOAD_ROOT = _MEDIA_ROOT / "chat_uploads"
_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10 MB
_ALLOWED_DOC_EXTS = {".pdf", ".doc", ".docx", ".txt", ".rtf", ".xls", ".xlsx", ".csv", ".odt"}
_ALLOWED_IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".heic"}
_ALLOWED_MIME_PREFIXES = ("image/",)
_ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "application/rtf",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "application/vnd.oasis.opendocument.text",
}


def _safe_filename(raw: str | None) -> str:
    name = (raw or "archivo").strip()
    name = re.sub(r"[^\w.\- ]+", "_", name)
    name = re.sub(r"\s+", "_", name)
    return name[:120] or "archivo"


def _attachment_kind(content_type: str, ext: str) -> str:
    if content_type.startswith("image/") or ext in _ALLOWED_IMG_EXTS:
        return "image"
    return "document"


def _is_allowed_attachment(content_type: str, ext: str) -> bool:
    if content_type.startswith(_ALLOWED_MIME_PREFIXES):
        return True
    if content_type in _ALLOWED_MIME_TYPES:
        return True
    if ext in _ALLOWED_DOC_EXTS or ext in _ALLOWED_IMG_EXTS:
        return True
    return False


class MessageIn(BaseModel):
    content: str = ""
    financial_document_url: str | None = None
    attachment_urls: list[str] | None = None


@router.post("/web/sessions", status_code=201)
async def new_session(request: Request, db: Session = Depends(get_db)):
    site_user = get_optional_user(request, db)
    session, result = await create_session(db, site_user)
    return {
        "session_id": str(session.id),
        "state": session.state,
        "rehydrated": bool(result.get("rehydrated", False)),
        "context_summary": result.get("context_summary") or "",
        "message": result["message"],
        "card": result["card"],
        "quick_replies": result.get("quick_replies", []),
    }


@router.post("/web/sessions/{session_id}/message")
async def send_message(session_id: str, body: MessageIn, db: Session = Depends(get_db)):
    try:
        sid = UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    try:
        content = (body.content or "").strip()
        extra_lines: list[str] = []
        for raw_url in body.attachment_urls or []:
            url = str(raw_url or "").strip()
            if url:
                extra_lines.append(f"Adjunto: {url}")
        if body.financial_document_url:
            doc_line = f"Sustento financiero: {body.financial_document_url.strip()}"
            extra_lines.append(doc_line)
        if extra_lines:
            content = "\n".join([part for part in [content, *extra_lines] if part]).strip()
        if not content:
            raise HTTPException(status_code=400, detail="Debes enviar texto o adjuntos.")
        result = await handle_message(session_id, content, db)
        session = db.query(WebChatSession).filter(WebChatSession.id == sid).first()
        return {
            "state": session.state if session else "unknown",
            "message": result["message"],
            "card": result.get("card"),
            "quick_replies": result.get("quick_replies", []),
        }
    except HTTPException:
        raise
    except Exception:
        return {
            "state": "collecting_info",
            "message": "Ocurrio un error. Por favor, intenta nuevamente.",
            "card": None,
            "quick_replies": [],
        }


@router.post("/web/sessions/{session_id}/attachments")
async def upload_attachment(
    session_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    try:
        sid = UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    session = db.query(WebChatSession).filter(WebChatSession.id == sid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.site_user_id and not session.is_active:
        raise HTTPException(status_code=409, detail="Session is inactive")

    safe_name = _safe_filename(file.filename)
    ext = Path(safe_name).suffix.lower()
    content_type = (file.content_type or "application/octet-stream").lower()
    if not _is_allowed_attachment(content_type, ext):
        raise HTTPException(
            status_code=400,
            detail="Tipo de archivo no permitido. Solo imagenes y documentos.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Archivo vacio.")
    if len(data) > _MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="Archivo demasiado grande (max 10 MB).")

    date_key = datetime.now(timezone.utc).strftime("%Y%m%d")
    out_dir = _CHAT_UPLOAD_ROOT / date_key / str(session.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4().hex}_{safe_name}"
    out_path = out_dir / stored_name
    out_path.write_bytes(data)

    relative_url = f"/media/chat_uploads/{date_key}/{session.id}/{stored_name}"
    return {
        "attachment_url": relative_url,
        "file_name": safe_name,
        "mime_type": content_type,
        "size": len(data),
        "kind": _attachment_kind(content_type, ext),
    }


@router.get("/web/sessions/{session_id}")
def get_session(session_id: str, db: Session = Depends(get_db)):
    try:
        uid = UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    session = db.query(WebChatSession).filter(WebChatSession.id == uid).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "id": str(session.id),
        "email": session.email,
        "name": session.name,
        "country": session.country,
        "phone": session.phone,
        "state": session.state,
        "is_active": bool(session.is_active),
        "inactivated_at": session.inactivated_at.isoformat() if session.inactivated_at else None,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in session.messages
        ],
    }
