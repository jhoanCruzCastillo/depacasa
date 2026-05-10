"""Web chatbot API — session-based, structured card responses."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from uuid import UUID

from database import get_db
from app.models.web_chat_session import WebChatSession
from app.services.web_conversation import create_session, handle_message
from app.routers.auth import get_optional_user

router = APIRouter()


class MessageIn(BaseModel):
    content: str


@router.post("/web/sessions", status_code=201)
async def new_session(request: Request, db: Session = Depends(get_db)):
    site_user = get_optional_user(request, db)
    session, result = await create_session(db, site_user)
    return {
        "session_id": str(session.id),
        "state": session.state,
        "message": result["message"],
        "card": result["card"],
    }


@router.post("/web/sessions/{session_id}/message")
async def send_message(session_id: str, body: MessageIn, db: Session = Depends(get_db)):
    try:
        UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    result = await handle_message(session_id, body.content, db)
    session = db.query(WebChatSession).filter(WebChatSession.id == UUID(session_id)).first()
    return {
        "state": session.state if session else "unknown",
        "message": result["message"],
        "card": result["card"],
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
