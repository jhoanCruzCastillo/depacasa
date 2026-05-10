"""Chat users CRUD + outbound send."""

import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID
from pydantic import BaseModel

from database import get_db
from app.models.chat_user import ChatUser
from app.models.chat_conversation import ChatConversation
from app.models.chat_message import ChatMessage, MessageDirection
from app.services.twilio_service import send_message

router = APIRouter()
logger = logging.getLogger(__name__)


from typing import Optional


class SendMessageIn(BaseModel):
    message: str


class ChatUserIn(BaseModel):
    phone_number: str
    name: Optional[str] = None


@router.get("/users")
async def list_users(skip: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    users = db.query(ChatUser).order_by(ChatUser.created_at.desc()).offset(skip).limit(limit).all()
    result = []
    for u in users:
        last_conv = (
            db.query(ChatConversation)
            .filter(ChatConversation.user_id == u.id)
            .order_by(ChatConversation.created_at.desc())
            .first()
        )
        last_msg = None
        if last_conv:
            lm = (
                db.query(ChatMessage)
                .filter(ChatMessage.conversation_id == last_conv.id)
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            if lm:
                last_msg = {
                    "content": lm.content[:120],
                    "direction": lm.direction,
                    "created_at": lm.created_at.isoformat(),
                }
        result.append(
            {
                "id": str(u.id),
                "phone_number": u.phone_number,
                "name": u.name,
                "profile": u.profile,
                "created_at": u.created_at.isoformat(),
                "updated_at": u.updated_at.isoformat() if u.updated_at else None,
                "conversation_state": last_conv.state if last_conv else None,
                "last_message": last_msg,
            }
        )
    return result


@router.get("/users/{user_id}")
async def get_user(user_id: UUID, db: Session = Depends(get_db)):
    user = db.query(ChatUser).filter(ChatUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    convs = (
        db.query(ChatConversation)
        .filter(ChatConversation.user_id == user_id)
        .order_by(ChatConversation.created_at.desc())
        .all()
    )
    conversations = []
    for c in convs:
        msgs = (
            db.query(ChatMessage)
            .filter(ChatMessage.conversation_id == c.id)
            .order_by(ChatMessage.created_at)
            .all()
        )
        conversations.append(
            {
                "id": str(c.id),
                "state": c.state,
                "ideal_description": c.ideal_description,
                "created_at": c.created_at.isoformat(),
                "messages": [
                    {
                        "direction": m.direction,
                        "content": m.content,
                        "created_at": m.created_at.isoformat(),
                    }
                    for m in msgs
                ],
            }
        )

    return {
        "id": str(user.id),
        "phone_number": user.phone_number,
        "name": user.name,
        "profile": user.profile,
        "created_at": user.created_at.isoformat(),
        "conversations": conversations,
    }


@router.post("/users/{user_id}/send")
async def send_to_user(user_id: UUID, body: SendMessageIn, db: Session = Depends(get_db)):
    user = db.query(ChatUser).filter(ChatUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    sid = send_message(user.phone_number, body.message)
    if not sid:
        raise HTTPException(status_code=500, detail="Failed to send message via Twilio")

    last_conv = (
        db.query(ChatConversation)
        .filter(ChatConversation.user_id == user_id)
        .order_by(ChatConversation.created_at.desc())
        .first()
    )
    if last_conv:
        msg = ChatMessage(
            conversation_id=last_conv.id,
            direction=MessageDirection.OUTBOUND,
            content=body.message,
            twilio_sid=sid,
        )
        db.add(msg)
        db.commit()

    return {"status": "sent", "sid": sid}


@router.post("/users", status_code=201)
async def create_user(body: ChatUserIn, db: Session = Depends(get_db)):
    existing = db.query(ChatUser).filter(ChatUser.phone_number == body.phone_number).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe un usuario con ese número")
    user = ChatUser(phone_number=body.phone_number, name=body.name, profile={"interaction_count": 0})
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "id": str(user.id),
        "phone_number": user.phone_number,
        "name": user.name,
        "profile": user.profile,
        "created_at": user.created_at.isoformat(),
        "updated_at": None,
        "conversation_state": None,
        "last_message": None,
    }


@router.patch("/users/{user_id}")
async def update_user(user_id: UUID, body: ChatUserIn, db: Session = Depends(get_db)):
    user = db.query(ChatUser).filter(ChatUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.phone_number != user.phone_number:
        existing = db.query(ChatUser).filter(ChatUser.phone_number == body.phone_number).first()
        if existing:
            raise HTTPException(status_code=409, detail="Número ya está en uso")
    user.phone_number = body.phone_number
    if body.name is not None:
        user.name = body.name
    db.commit()
    db.refresh(user)
    return {"id": str(user.id), "phone_number": user.phone_number, "name": user.name}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: UUID, db: Session = Depends(get_db)):
    user = db.query(ChatUser).filter(ChatUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
