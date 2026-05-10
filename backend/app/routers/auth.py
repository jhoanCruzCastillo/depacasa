"""Public auth endpoints: register, login, me."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from uuid import UUID

from database import get_db
from app.models.site_user import SiteUser
from app.services.auth_service import hash_password, verify_password, create_token, decode_token

router = APIRouter()


class RegisterIn(BaseModel):
    email: str
    password: str
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
        "wants_newsletter": user.wants_newsletter,
    }


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
        wants_newsletter=body.wants_newsletter,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"token": create_token(str(user.id)), "user": _user_out(user)}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(SiteUser).filter(SiteUser.email == body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")
    return {"token": create_token(str(user.id)), "user": _user_out(user)}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    user = get_optional_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="No autenticado.")
    return _user_out(user)
