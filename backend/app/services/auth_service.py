"""Authentication helpers: password hashing, JWT tokens, email extraction."""

import re
import logging
from datetime import datetime, timedelta

import bcrypt
from jose import jwt
from config import settings

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(days=settings.JWT_EXPIRE_DAYS)
    return jwt.encode({"sub": user_id, "exp": expire}, settings.SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> str:
    """Returns user_id string or raises JWTError."""
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    return payload["sub"]


def extract_email(raw: str) -> str | None:
    """Pull an email address from free-form text."""
    m = _EMAIL_RE.search(raw)
    return m.group().lower() if m else None
