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
from app.models.user_preference import UserPreference
from app.models.user_property_interaction import UserPropertyInteraction
from app.models.search_history import SearchHistory
from app.models.scraped_record import ScrapedRecord
from app.models.web_chat_session import WebChatSession

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


def _norm_key(key: str) -> str:
    return (
        (key or "")
        .strip()
        .lower()
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace("ñ", "n")
    )


def _first_scalar_by_keys(obj, keys: set[str]) -> Optional[str]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if _norm_key(str(k)) in keys and isinstance(v, (str, int, float)):
                value = str(v).strip()
                if value:
                    return value
        for v in obj.values():
            found = _first_scalar_by_keys(v, keys)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _first_scalar_by_keys(item, keys)
            if found:
                return found
    return None


def _summarize_record(record: Optional[ScrapedRecord]) -> dict:
    if not record:
        return {
            "source_url": None,
            "property_title": None,
            "property_model": None,
            "property_location": None,
            "property_price": None,
        }

    data = record.data if isinstance(record.data, dict) else {}
    title = _first_scalar_by_keys(
        data,
        {"titulo", "title", "nombre", "name", "proyecto", "project", "project_name"},
    )
    model = _first_scalar_by_keys(data, {"modelo", "model", "tipo", "tipologia", "tipologia_modelo"})
    location = _first_scalar_by_keys(
        data,
        {"ubicacion", "direccion", "distrito", "zona", "location", "address"},
    )
    price = _first_scalar_by_keys(
        data,
        {"precio", "price", "precio_desde", "from_price", "monto"},
    )

    return {
        "source_url": record.source_url,
        "property_title": title,
        "property_model": model,
        "property_location": location,
        "property_price": price,
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


@router.get("/{user_id}/profile")
def get_user_profile(user_id: UUID, db: Session = Depends(get_db)):
    """Admin view: full preference + interaction + history profile for a user."""
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    pref = db.query(UserPreference).filter_by(site_user_id=user_id).first()

    interactions = (
        db.query(UserPropertyInteraction)
        .filter_by(site_user_id=user_id)
        .order_by(UserPropertyInteraction.created_at.desc())
        .limit(20)
        .all()
    )
    record_ids = [i.record_id for i in interactions if i.record_id]
    record_map = {}
    if record_ids:
        rows = db.query(ScrapedRecord).filter(ScrapedRecord.id.in_(record_ids)).all()
        record_map = {r.id: r for r in rows}

    history = (
        db.query(SearchHistory)
        .filter_by(site_user_id=user_id)
        .order_by(SearchHistory.created_at.desc())
        .limit(20)
        .all()
    )

    lead_data: dict = {}
    lead_updated_at = None
    sessions = (
        db.query(WebChatSession)
        .filter(WebChatSession.site_user_id == user_id)
        .order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
        .limit(25)
        .all()
    )
    for s in sessions:
        criteria = s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {}
        candidate = criteria.get("_lead")
        if isinstance(candidate, dict) and candidate:
            lead_data = candidate
            lead_updated_at = s.updated_at or s.created_at
            break

    return {
        "user": _out(u),
        "lead": {
            "full_name": lead_data.get("full_name"),
            "whatsapp": lead_data.get("whatsapp"),
            "document_number": lead_data.get("document_number"),
            "country_of_residence": lead_data.get("country_of_residence"),
            "record_id": str(lead_data.get("record_id")) if lead_data.get("record_id") else None,
            "rating": lead_data.get("rating"),
            "updated_at": lead_updated_at.isoformat() if lead_updated_at else None,
        },
        "preferences": {
            "location": pref.location,
            "bedrooms": pref.bedrooms,
            "min_price": pref.min_price,
            "max_price": pref.max_price,
            "features": pref.features or [],
            "keywords": pref.keywords or [],
            "raw_description": pref.raw_description,
            "updated_at": pref.updated_at.isoformat() if pref.updated_at else None,
        } if pref else None,
        "interactions": [
            {
                "record_id": str(i.record_id),
                "rating": i.rating,
                "interested": i.interested,
                "seen_in_chat": i.seen_in_chat,
                "rated_at": i.rated_at.isoformat() if i.rated_at else None,
                "seen_at": i.seen_at.isoformat() if i.seen_at else None,
                "created_at": i.created_at.isoformat() if i.created_at else None,
                **_summarize_record(record_map.get(i.record_id)),
            }
            for i in interactions
        ],
        "search_history": [
            {
                "id": str(h.id),
                "query": h.query,
                "location": h.location,
                "source": h.source,
                "created_at": h.created_at.isoformat() if h.created_at else None,
            }
            for h in history
        ],
    }


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
