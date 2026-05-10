"""Chat templates CRUD."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List
from pydantic import BaseModel

from database import get_db
from app.models.chat_template import ChatTemplate

router = APIRouter()


class TemplateIn(BaseModel):
    name: str
    type: str
    content: str
    variables: List[str] = []
    is_active: bool = True


def _serialize(t: ChatTemplate) -> dict:
    return {
        "id": str(t.id),
        "name": t.name,
        "type": t.type,
        "content": t.content,
        "variables": t.variables or [],
        "is_active": t.is_active,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


@router.get("/templates")
async def list_templates(db: Session = Depends(get_db)):
    return [_serialize(t) for t in db.query(ChatTemplate).order_by(ChatTemplate.created_at.desc()).all()]


@router.post("/templates", status_code=status.HTTP_201_CREATED)
async def create_template(body: TemplateIn, db: Session = Depends(get_db)):
    t = ChatTemplate(**body.dict())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _serialize(t)


@router.get("/templates/{template_id}")
async def get_template(template_id: UUID, db: Session = Depends(get_db)):
    t = db.query(ChatTemplate).filter(ChatTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return _serialize(t)


@router.put("/templates/{template_id}")
async def update_template(template_id: UUID, body: TemplateIn, db: Session = Depends(get_db)):
    t = db.query(ChatTemplate).filter(ChatTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    for k, v in body.dict().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _serialize(t)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: UUID, db: Session = Depends(get_db)):
    t = db.query(ChatTemplate).filter(ChatTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(t)
    db.commit()
