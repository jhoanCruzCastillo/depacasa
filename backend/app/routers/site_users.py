"""Admin CRUD for registered site users + test email."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from uuid import UUID

from database import get_db
from app.models.site_user import SiteUser
from app.services.email_service import send_email

router = APIRouter(prefix="/api/site-users", tags=["site-users"])


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    country: Optional[str] = None
    phone: Optional[str] = None
    wants_newsletter: Optional[bool] = None


class TestEmailIn(BaseModel):
    subject: str = "Correo de prueba"
    body: str = "Este es un correo de prueba enviado desde el panel de administración."


def _out(u: SiteUser) -> dict:
    return {
        "id": str(u.id),
        "email": u.email,
        "name": u.name,
        "country": u.country,
        "phone": u.phone,
        "wants_newsletter": u.wants_newsletter,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("")
def list_users(skip: int = 0, limit: int = 20, search: str = "", db: Session = Depends(get_db)):
    q = db.query(SiteUser)
    if search:
        term = f"%{search}%"
        q = q.filter(
            SiteUser.email.ilike(term) |
            SiteUser.name.ilike(term) |
            SiteUser.country.ilike(term)
        )
    total = q.with_entities(func.count()).scalar()
    users = q.order_by(SiteUser.created_at.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": [_out(u) for u in users]}


@router.get("/{user_id}")
def get_user(user_id: UUID, db: Session = Depends(get_db)):
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return _out(u)


@router.put("/{user_id}")
def update_user(user_id: UUID, body: UserUpdate, db: Session = Depends(get_db)):
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    if body.email is not None:
        existing = db.query(SiteUser).filter(SiteUser.email == body.email.lower(), SiteUser.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Ese correo ya está en uso.")
        u.email = body.email.lower()
    for field in ("name", "country", "phone", "wants_newsletter"):
        val = getattr(body, field)
        if val is not None:
            setattr(u, field, val)
    db.commit()
    db.refresh(u)
    return _out(u)


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: UUID, db: Session = Depends(get_db)):
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    db.delete(u)
    db.commit()


@router.post("/{user_id}/send-email")
def send_test_email(user_id: UUID, body: TestEmailIn, db: Session = Depends(get_db)):
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px 24px">
      <p style="color:#1e3a5f;font-size:15px;line-height:1.6">{body.body}</p>
    </div>
    """
    ok = send_email(u.email, body.subject, html)
    if not ok:
        raise HTTPException(status_code=503, detail="No se pudo enviar el correo. Verifica la configuración de Resend.")
    return {"sent": True, "to": u.email}
