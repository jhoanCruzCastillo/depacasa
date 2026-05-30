"""Sales advisors CRUD + advisor auth + marketplace."""

from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from uuid import UUID
from typing import Optional, List
from datetime import datetime, timezone
from pydantic import BaseModel

from database import get_db
from app.models.sales_advisor import SalesAdvisor
from app.models.web_chat_session import WebChatSession
from app.models.site_user import SiteUser
from app.models.propiedad import Propiedad
from app.models.proyecto import Proyecto
from app.models.user_property_interaction import UserPropertyInteraction
from app.models.advisor_lead_purchase import AdvisorLeadPurchase
from app.models.developer import Developer
from app.services.auth_service import hash_password, verify_password, create_token, decode_token
from app.services.email_service import send_email
from app.services.lead_scoring_service import compute_score_for_user_id, load_scoring_config

router = APIRouter()


class AdvisorIn(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    whatsapp_number: Optional[str] = None
    is_active: bool = True
    developer_id: Optional[str] = None


class AdvisorLoginIn(BaseModel):
    email: str
    password: str


class AdvisorRegisterIn(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    password: str


class AdvisorSetPasswordIn(BaseModel):
    password: str


def _get_current_advisor(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> SalesAdvisor:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No autenticado")
    token = authorization.split(" ", 1)[1]
    try:
        advisor_id = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    advisor = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not advisor or not advisor.is_active:
        raise HTTPException(status_code=401, detail="Asesor no encontrado o inactivo")
    return advisor


def _serialize(a: SalesAdvisor, db: Session = None) -> dict:
    developer_name = None
    if db and a.developer_id:
        dev = db.query(Developer).filter(Developer.id == a.developer_id).first()
        developer_name = dev.name if dev else None
    return {
        "id": str(a.id),
        "name": a.name,
        "phone": a.phone,
        "email": a.email,
        "whatsapp_number": a.whatsapp_number,
        "is_active": a.is_active,
        "developer_id": str(a.developer_id) if a.developer_id else None,
        "developer_name": developer_name,
        "bio": a.bio,
        "specialty": a.specialty,
        "created_at": a.created_at.isoformat(),
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


def _summarize_record(record: Propiedad | None) -> dict:
    if not record:
        return {
            "record_id": None,
            "title": None,
            "location": None,
            "price": None,
        }

    data = record.to_data() if hasattr(record, 'to_data') else {}
    values = [str(v).strip() for v in data.values() if isinstance(v, (str, int, float))]
    return {
        "record_id": str(record.id),
        "title": data.get("nombre") or next((v for v in values if len(v) >= 6), None),
        "location": data.get("ubicacion") or next((v for v in values if any(k in v.lower() for k in ["lima", "miraflores", "surco", "san "])), None),
        "price": data.get("precio_desde") or next((v for v in values if any(ch.isdigit() for ch in v) and any(sym in v.lower() for sym in ["$", "s/", "usd", "precio"])), None),
    }


def _parse_iso(dt_str: str | None) -> datetime | None:
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        return None


def _to_timestamp(dt_value: datetime | None) -> float:
    if not dt_value:
        return 0.0
    if dt_value.tzinfo is None:
        return dt_value.replace(tzinfo=timezone.utc).timestamp()
    return dt_value.timestamp()


def _extract_lead(criteria: dict | None) -> dict:
    if not isinstance(criteria, dict):
        return {}
    lead = criteria.get("_lead")
    return lead if isinstance(lead, dict) else {}


def _build_client_key(session: WebChatSession, lead: dict) -> str:
    if session.site_user_id:
        return f"user:{session.site_user_id}"
    if lead.get("whatsapp"):
        return f"whatsapp:{lead.get('whatsapp')}"
    if lead.get("document_number"):
        return f"document:{lead.get('document_number')}"
    return f"session:{session.id}"


def _get_assigned_sessions_for_advisor(advisor_id: str, db: Session) -> list[WebChatSession]:
    sessions = (
        db.query(WebChatSession)
        .order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
        .all()
    )
    out: list[WebChatSession] = []
    for s in sessions:
        lead = _extract_lead(s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {})
        if str(lead.get("advisor_id") or "") == advisor_id:
            out.append(s)
    return out


def _dedupe_latest_clients(sessions: list[WebChatSession]) -> list[WebChatSession]:
    latest_by_client: dict[str, WebChatSession] = {}
    assigned_at_by_client: dict[str, float] = {}
    for s in sessions:
        lead = _extract_lead(s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {})
        key = _build_client_key(s, lead)
        assigned_at = _parse_iso(lead.get("advisor_assigned_at")) or s.updated_at or s.created_at
        current = latest_by_client.get(key)
        assigned_ts = _to_timestamp(assigned_at)
        if not current or assigned_ts > assigned_at_by_client[key]:
            latest_by_client[key] = s
            assigned_at_by_client[key] = assigned_ts
    return sorted(
        latest_by_client.values(),
        key=lambda s: _to_timestamp(
            _parse_iso(_extract_lead(s.extracted_criteria).get("advisor_assigned_at")) or s.updated_at or s.created_at
        ),
        reverse=True,
    )


@router.get("/advisors")
async def list_advisors(db: Session = Depends(get_db)):
    advisors = db.query(SalesAdvisor).order_by(SalesAdvisor.created_at.desc()).all()
    sessions = (
        db.query(WebChatSession)
        .order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
        .all()
    )
    count_by_advisor: dict[str, set[str]] = {}
    for s in sessions:
        lead = _extract_lead(s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {})
        advisor_id = str(lead.get("advisor_id") or "")
        if not advisor_id:
            continue
        key = _build_client_key(s, lead)
        count_by_advisor.setdefault(advisor_id, set()).add(key)

    out = []
    for a in advisors:
        row = _serialize(a)
        row["assigned_clients_count"] = len(count_by_advisor.get(str(a.id), set()))
        out.append(row)
    return out


@router.post("/advisors", status_code=status.HTTP_201_CREATED)
async def create_advisor(body: AdvisorIn, db: Session = Depends(get_db)):
    a = SalesAdvisor(
        name=body.name, phone=body.phone, email=body.email,
        whatsapp_number=body.whatsapp_number, is_active=body.is_active,
        developer_id=UUID(body.developer_id) if body.developer_id else None,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _serialize(a, db)


@router.get("/advisors/{advisor_id}/clients")
async def get_advisor_clients(advisor_id: UUID, db: Session = Depends(get_db)):
    advisor = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not advisor:
        raise HTTPException(status_code=404, detail="Advisor not found")

    sessions = _dedupe_latest_clients(_get_assigned_sessions_for_advisor(str(advisor_id), db))
    user_ids = [s.site_user_id for s in sessions if s.site_user_id]
    users_map: dict[UUID, SiteUser] = {}
    if user_ids:
        rows = db.query(SiteUser).filter(SiteUser.id.in_(user_ids)).all()
        users_map = {u.id: u for u in rows}

    record_ids: list[UUID] = []
    for s in sessions:
        lead = _extract_lead(s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {})
        rid = lead.get("record_id")
        if not rid:
            continue
        try:
            record_ids.append(UUID(str(rid)))
        except Exception:
            continue
    record_map: dict[UUID, Propiedad] = {}
    if record_ids:
        rows = db.query(Propiedad).filter(Propiedad.id.in_(record_ids)).all()
        record_map = {r.id: r for r in rows}

    clients = []
    for s in sessions:
        criteria = s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {}
        lead = _extract_lead(criteria)
        user = users_map.get(s.site_user_id) if s.site_user_id else None

        record = None
        rid = lead.get("record_id")
        if rid:
            try:
                record = record_map.get(UUID(str(rid)))
            except Exception:
                record = None

        clients.append(
            {
                "session_id": str(s.id),
                "site_user_id": str(s.site_user_id) if s.site_user_id else None,
                "full_name": lead.get("full_name") or s.name or (user.name if user else None),
                "email": s.email or (user.email if user else None),
                "whatsapp": lead.get("whatsapp") or s.phone or (user.phone if user else None),
                "country_of_residence": lead.get("country_of_residence") or s.country or (user.country if user else None),
                "document_number": lead.get("document_number"),
                "financial_capacity_doc": lead.get("financial_capacity_doc"),
                "rating": lead.get("rating"),
                "assigned_at": lead.get("advisor_assigned_at"),
                "notified_at": lead.get("advisor_notified_at"),
                "profiling": {k: v for k, v in criteria.items() if not str(k).startswith("_")},
                "property": _summarize_record(record),
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
        )

    return {
        "advisor": _serialize(advisor),
        "total_clients": len(clients),
        "clients": clients,
    }


@router.put("/advisors/{advisor_id}")
async def update_advisor(advisor_id: UUID, body: AdvisorIn, db: Session = Depends(get_db)):
    a = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Advisor not found")
    a.name = body.name
    a.phone = body.phone
    a.email = body.email
    a.whatsapp_number = body.whatsapp_number
    a.is_active = body.is_active
    a.developer_id = UUID(body.developer_id) if body.developer_id else None
    db.commit()
    db.refresh(a)
    return _serialize(a, db)


@router.delete("/advisors/{advisor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_advisor(advisor_id: UUID, db: Session = Depends(get_db)):
    a = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Advisor not found")
    db.delete(a)
    db.commit()


# ── Advisor auth endpoints ─────────────────────────────────────────────────────

@router.post("/advisors/register", status_code=201)
def advisor_register(body: AdvisorRegisterIn, db: Session = Depends(get_db)):
    if not body.name.strip() or not body.email.strip() or len(body.password) < 6:
        raise HTTPException(status_code=422, detail="Datos inválidos")
    existing = db.query(SalesAdvisor).filter(SalesAdvisor.email == body.email.strip().lower()).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe un asesor con ese correo")
    advisor = SalesAdvisor(
        name=body.name.strip(),
        email=body.email.strip().lower(),
        phone=body.phone,
        password_hash=hash_password(body.password),
        is_active=False,
    )
    db.add(advisor)
    db.commit()
    return {"ok": True}


@router.post("/advisors/login")
def advisor_login(body: AdvisorLoginIn, db: Session = Depends(get_db)):
    advisor = db.query(SalesAdvisor).filter(
        SalesAdvisor.email == body.email.strip().lower(),
        SalesAdvisor.is_active == True,
    ).first()
    if not advisor or not advisor.password_hash:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    if not verify_password(body.password, advisor.password_hash):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    token = create_token(str(advisor.id))
    return {"token": token, "advisor": _serialize(advisor)}


@router.get("/advisors/me")
def advisor_me(current: SalesAdvisor = Depends(_get_current_advisor)):
    return _serialize(current)


@router.patch("/advisors/{advisor_id}/set-password", status_code=200)
def set_advisor_password(advisor_id: UUID, body: AdvisorSetPasswordIn, db: Session = Depends(get_db)):
    a = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Advisor not found")
    if not body.password or len(body.password) < 6:
        raise HTTPException(status_code=422, detail="La contraseña debe tener al menos 6 caracteres")
    a.password_hash = hash_password(body.password)
    db.commit()
    return {"ok": True}


class AdvisorEmailIn(BaseModel):
    subject: str
    body: str


@router.post("/advisors/{advisor_id}/send-email")
def send_advisor_email(advisor_id: UUID, body: AdvisorEmailIn, db: Session = Depends(get_db)):
    a = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asesor no encontrado")
    if not a.email:
        raise HTTPException(status_code=422, detail="Este asesor no tiene correo registrado")
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px 24px">
      <p style="color:#1e3a5f;font-size:15px;line-height:1.6">{body.body}</p>
    </div>
    """
    ok = send_email(a.email, body.subject, html)
    if not ok:
        raise HTTPException(status_code=503, detail="No se pudo enviar el correo. Verifica la configuración de Resend.")
    return {"sent": True, "to": a.email}


# ── Advisor self-profile update ────────────────────────────────────────────────

class AdvisorProfileIn(BaseModel):
    name: str
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None
    developer_id: Optional[str] = None
    bio: Optional[str] = None
    specialty: Optional[str] = None


@router.patch("/advisors/me/profile")
def update_my_profile(body: AdvisorProfileIn, current: SalesAdvisor = Depends(_get_current_advisor), db: Session = Depends(get_db)):
    current.name = body.name.strip() or current.name
    current.phone = body.phone
    current.whatsapp_number = body.whatsapp_number
    current.developer_id = UUID(body.developer_id) if body.developer_id else None
    current.bio = body.bio
    current.specialty = body.specialty
    db.commit()
    db.refresh(current)
    advisor_dict = _serialize(current)
    advisor_dict["developer_id"] = str(current.developer_id) if current.developer_id else None
    advisor_dict["bio"] = current.bio
    advisor_dict["specialty"] = current.specialty
    # attach developer name
    if current.developer_id:
        dev = db.query(Developer).filter(Developer.id == current.developer_id).first()
        advisor_dict["developer_name"] = dev.name if dev else None
    else:
        advisor_dict["developer_name"] = None
    return advisor_dict


@router.get("/advisors/me/full")
def get_my_full_profile(current: SalesAdvisor = Depends(_get_current_advisor), db: Session = Depends(get_db)):
    advisor_dict = _serialize(current)
    advisor_dict["developer_id"] = str(current.developer_id) if current.developer_id else None
    advisor_dict["bio"] = current.bio
    advisor_dict["specialty"] = current.specialty
    if current.developer_id:
        dev = db.query(Developer).filter(Developer.id == current.developer_id).first()
        advisor_dict["developer_name"] = dev.name if dev else None
    else:
        advisor_dict["developer_name"] = None
    return advisor_dict


# ── Marketplace ────────────────────────────────────────────────────────────────

def _mask_name(name: Optional[str], email: Optional[str]) -> str:
    if name:
        parts = name.strip().split()
        return parts[0] if parts else "Lead"
    if email:
        local = email.split("@")[0]
        return local[0].upper() + "***" if local else "Lead"
    return "Lead anónimo"


def _mask_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    local, domain = email.split("@") if "@" in email else (email, "")
    return local[0] + "***@" + domain if domain else local[0] + "***"


@router.get("/advisors/marketplace")
def get_marketplace(current: SalesAdvisor = Depends(_get_current_advisor), db: Session = Depends(get_db)):
    if not current.developer_id:
        return {"leads": [], "message": "Asocia tu cuenta a una desarrolladora para ver leads."}

    # Get all properties for this developer (through proyectos)
    proyecto_ids = [
        r[0] for r in db.query(Proyecto.id)
        .filter(Proyecto.developer_id == current.developer_id)
        .all()
    ]
    if not proyecto_ids:
        return {"leads": []}

    prop_ids = [
        r[0] for r in db.query(Propiedad.id)
        .filter(Propiedad.proyecto_id.in_(proyecto_ids))
        .all()
    ]
    if not prop_ids:
        return {"leads": []}

    # Only users who rated (≥1 estrella), commented, or marcaron "Lo quiero"
    interactions = (
        db.query(UserPropertyInteraction)
        .filter(
            UserPropertyInteraction.record_id.in_(prop_ids),
            UserPropertyInteraction.site_user_id.isnot(None),
            or_(
                UserPropertyInteraction.rating.isnot(None),
                and_(
                    UserPropertyInteraction.comment.isnot(None),
                    UserPropertyInteraction.comment != "",
                ),
                UserPropertyInteraction.interested == True,
            ),
        )
        .all()
    )

    # Group by user
    from collections import defaultdict
    user_props: dict = defaultdict(list)
    for i in interactions:
        user_props[i.site_user_id].append(i)

    if not user_props:
        return {"leads": []}

    # Load users
    users = {u.id: u for u in db.query(SiteUser).filter(SiteUser.id.in_(list(user_props.keys()))).all()}

    # Load property titles
    props_map = {p.id: p for p in db.query(Propiedad).filter(Propiedad.id.in_(prop_ids)).all()}

    # Load purchases for this advisor
    purchases = {
        str(p.site_user_id)
        for p in db.query(AdvisorLeadPurchase)
        .filter(AdvisorLeadPurchase.advisor_id == current.id)
        .all()
    }

    # Load scoring config for pricing
    cfg = load_scoring_config(db)
    tier_prices = {
        "muy_caliente": float(cfg.get("price_muy_caliente") or 0),
        "caliente":     float(cfg.get("price_caliente") or 0),
        "tibio":        float(cfg.get("price_tibio") or 0),
        "frio":         float(cfg.get("price_frio") or 0),
    }
    currency = cfg.get("price_currency", "PEN")

    leads = []
    for user_id, user_interactions in user_props.items():
        user = users.get(user_id)
        if not user:
            continue

        score_data = compute_score_for_user_id(user_id, db)
        tier_key = score_data["tier"]["key"] if score_data else "frio"
        score_total = score_data["total"] if score_data else 0
        tier_label = score_data["tier"]["label"] if score_data else "Frío"
        price = tier_prices.get(tier_key, 0)

        is_unlocked = str(user_id) in purchases

        # Build property list
        prop_list = []
        seen_prop_ids = set()
        for inter in user_interactions:
            if inter.record_id in seen_prop_ids:
                continue
            seen_prop_ids.add(inter.record_id)
            prop = props_map.get(inter.record_id)
            prop_data = prop.extra_data if prop and isinstance(prop.extra_data, dict) else {}
            title = (
                prop_data.get("titulo") or prop_data.get("title") or
                prop_data.get("nombre") or prop_data.get("modelo") or
                (prop.modelo if prop else None) or
                f"Propiedad {str(inter.record_id)[:8]}"
            )
            prop_list.append({
                "id": str(inter.record_id),
                "title": title,
                "interested": inter.interested,
                "rating": inter.rating,
            })

        leads.append({
            "user_id": str(user_id),
            "display_name": _mask_name(user.name, user.email) if not is_unlocked else (user.name or user.email or "Sin nombre"),
            "masked_email": _mask_email(user.email) if not is_unlocked else user.email,
            "is_unlocked": is_unlocked,
            "score": score_total,
            "tier_key": tier_key,
            "tier_label": tier_label,
            "price": price,
            "currency": currency,
            "properties": prop_list,
            # Full info only if unlocked
            "full_name": user.name if is_unlocked else None,
            "email": user.email if is_unlocked else None,
            "phone": user.phone if is_unlocked else None,
            "whatsapp": user.whatsapp if is_unlocked else None,
            "country": user.country if is_unlocked else None,
        })

    # Sort by score desc
    leads.sort(key=lambda x: x["score"], reverse=True)
    return {"leads": leads, "currency": currency}


@router.post("/advisors/marketplace/{user_id}/unlock")
def unlock_lead(user_id: UUID, current: SalesAdvisor = Depends(_get_current_advisor), db: Session = Depends(get_db)):
    user = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    existing = db.query(AdvisorLeadPurchase).filter(
        AdvisorLeadPurchase.advisor_id == current.id,
        AdvisorLeadPurchase.site_user_id == user_id,
    ).first()
    if existing:
        return {"already_unlocked": True, "email": user.email, "phone": user.phone, "whatsapp": user.whatsapp}

    cfg = load_scoring_config(db)
    score_data = compute_score_for_user_id(user_id, db)
    tier_key = score_data["tier"]["key"] if score_data else "frio"
    tier_prices = {
        "muy_caliente": float(cfg.get("price_muy_caliente") or 0),
        "caliente":     float(cfg.get("price_caliente") or 0),
        "tibio":        float(cfg.get("price_tibio") or 0),
        "frio":         float(cfg.get("price_frio") or 0),
    }
    price = tier_prices.get(tier_key, 0)
    currency = cfg.get("price_currency", "PEN")

    purchase = AdvisorLeadPurchase(
        advisor_id=current.id,
        site_user_id=user_id,
        price_paid=price,
        currency=currency,
    )
    db.add(purchase)
    db.commit()

    return {
        "unlocked": True,
        "price_paid": price,
        "currency": currency,
        "full_name": user.name,
        "email": user.email,
        "phone": user.phone,
        "whatsapp": user.whatsapp,
        "country": user.country,
    }


@router.get("/advisors/developers-list")
def list_developers_for_advisors(db: Session = Depends(get_db)):
    devs = db.query(Developer.id, Developer.name).order_by(Developer.name).all()
    return [{"id": str(d.id), "name": d.name} for d in devs]


# ── Must be LAST: catches any /advisors/{uuid} not matched above ───────────────
@router.get("/advisors/{advisor_id}")
async def get_advisor(advisor_id: UUID, db: Session = Depends(get_db)):
    a = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Advisor not found")
    return _serialize(a, db)
