"""Public auth endpoints: register, login, me."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from uuid import UUID

from database import get_db
from app.models.site_user import SiteUser
from app.models.user_property_interaction import UserPropertyInteraction
from app.models.propiedad import Propiedad
from app.models.proyecto import Proyecto
from app.services.auth_service import hash_password, verify_password, create_token, decode_token
from app.services.email_service import send_welcome
from app.services.notification_service import create_notification

router = APIRouter()


class RegisterIn(BaseModel):
    email: str
    password: str
    name: str
    country: Optional[str] = None
    wants_newsletter: bool = False


class LoginIn(BaseModel):
    email: str
    password: str


def _user_out(user: SiteUser) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "country": user.country,
        "phone": user.phone,
        "whatsapp": user.whatsapp,
        "wants_newsletter": user.wants_newsletter,
    }


class UpdateMeIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    country: Optional[str] = None
    wants_newsletter: Optional[bool] = None


def get_optional_user(request: Request, db: Session) -> SiteUser | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        user_id = decode_token(auth.split(" ", 1)[1])
        return db.query(SiteUser).filter(SiteUser.id == UUID(user_id)).first()
    except Exception:
        return None


@router.post("/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    existing = db.query(SiteUser).filter(SiteUser.email == body.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Este correo ya está registrado.")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres.")
    user = SiteUser(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        name=body.name,
        country=body.country,
        wants_newsletter=body.wants_newsletter,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    send_welcome(user.email, user.name or "")
    create_notification(
        db,
        type="user_registered",
        title=f"Nuevo usuario registrado: {user.name or user.email}",
        reference_id=user.id,
        reference_type="site_user",
    )
    return {"token": create_token(str(user.id)), "user": _user_out(user)}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(SiteUser).filter(SiteUser.email == body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")
    return {"token": create_token(str(user.id)), "user": _user_out(user)}


# ── Admin auth ────────────────────────────────────────────────────────────────

@router.post("/admin/login")
def admin_login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(SiteUser).filter(
        SiteUser.email == body.email.lower(),
        SiteUser.role == "ADMIN",
    ).first()
    if not user or not verify_password(body.password, user.password_hash or ""):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas.")
    return {"token": create_token(str(user.id)), "user": _user_out(user)}


@router.get("/admin/me")
def admin_me(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No autenticado.")
    try:
        user_id = decode_token(auth.split(" ", 1)[1])
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido.")
    user = db.query(SiteUser).filter(
        SiteUser.id == UUID(user_id), SiteUser.role == "ADMIN",
    ).first()
    if not user:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    return _user_out(user)


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    user = get_optional_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="No autenticado.")
    return _user_out(user)


@router.get("/me/history")
def me_history(request: Request, db: Session = Depends(get_db)):
    user = get_optional_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="No autenticado.")

    interactions = (
        db.query(UserPropertyInteraction)
        .filter(UserPropertyInteraction.site_user_id == user.id)
        .order_by(UserPropertyInteraction.updated_at.desc().nullslast(),
                  UserPropertyInteraction.created_at.desc())
        .limit(100)
        .all()
    )

    record_ids = [i.record_id for i in interactions]
    props = {p.id: p for p in db.query(Propiedad).filter(Propiedad.id.in_(record_ids)).all()}
    proyecto_ids = {p.proyecto_id for p in props.values() if p.proyecto_id}
    proyectos = {p.id: p for p in db.query(Proyecto).filter(Proyecto.id.in_(proyecto_ids)).all()}

    items = []
    for ix in interactions:
        prop = props.get(ix.record_id)
        if not prop:
            continue
        data = prop.to_data()
        proyecto = proyectos.get(prop.proyecto_id) if prop.proyecto_id else None
        items.append({
            "record_id": str(ix.record_id),
            "seen_in_chat": ix.seen_in_chat,
            "rating": ix.rating,
            "interested": ix.interested,
            "comment": ix.comment,
            "seen_at": ix.seen_at.isoformat() if ix.seen_at else None,
            "rated_at": ix.rated_at.isoformat() if ix.rated_at else None,
            "created_at": ix.created_at.isoformat() if ix.created_at else None,
            "property": {
                "id": str(prop.id),
                "modelo": data.get("modelo") or data.get("tipo") or "Propiedad",
                "dormitorios": prop.dormitorios or data.get("dormitorios"),
                "baños": prop.baños or data.get("baños"),
                "m2": prop.m2 or data.get("m2"),
                "imagen": prop.imagen_modelo or prop.modelo_imagen or data.get("imagen"),
                "precio": data.get("precio") or data.get("precio_desde"),
                "proyecto_nombre": proyecto.nombre if proyecto else data.get("proyecto"),
                "ubicacion": data.get("ubicacion") or data.get("distrito"),
            },
        })

    return {"items": items, "total": len(items)}


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


@router.put("/me/password")
def change_password(body: ChangePasswordIn, request: Request, db: Session = Depends(get_db)):
    user = get_optional_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="No autenticado.")
    if not verify_password(body.current_password, user.password_hash or ""):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta.")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 6 caracteres.")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True}


@router.put("/me")
def update_me(body: UpdateMeIn, request: Request, db: Session = Depends(get_db)):
    user = get_optional_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="No autenticado.")
    for field in ("name", "phone", "whatsapp", "country", "wants_newsletter"):
        val = getattr(body, field)
        if val is not None:
            setattr(user, field, val)
    db.commit()
    db.refresh(user)
    return _user_out(user)
