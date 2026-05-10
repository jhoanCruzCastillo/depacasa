"""Public-facing API — no authentication required."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from app.models.site_config import SiteConfig, DEFAULT_SITE_CONFIG_ID, DEFAULT_CARD_FIELDS

router = APIRouter()

_DEFAULTS = {
    "site_name": "Mi Portal Inmobiliario",
    "tagline": None,
    "primary_color": "#2563eb",
    "secondary_color": "#059669",
    "logo_text": None,
    "show_hero": True,
    "hero_title": "Encuentra tu propiedad ideal",
    "hero_subtitle": "Explora los mejores proyectos disponibles",
    "hero_cta_text": "Explorar propiedades",
    "hero_bg_color": "#1e3a5f",
    "show_carousel": True,
    "carousel_title": "Proyectos destacados",
    "carousel_field_image": "image_url",
    "show_listing": True,
    "listing_title": "Propiedades disponibles",
    "listing_columns": "3",
    "footer_text": "© 2025 Portal Inmobiliario",
    "footer_contact": None,
    "card_fields": DEFAULT_CARD_FIELDS,
    "chatbot_enabled": True,
    "chatbot_greeting": "¡Hola! Soy tu asistente inmobiliario. ¿Cuál es tu nombre?",
    "chatbot_button_label": "¿Necesitas ayuda?",
}


@router.get("/config")
def public_config(db: Session = Depends(get_db)):
    cfg = db.query(SiteConfig).filter(SiteConfig.id == DEFAULT_SITE_CONFIG_ID).first()
    if not cfg:
        return _DEFAULTS
    return {k: getattr(cfg, k) for k in _DEFAULTS}


@router.get("/records")
def public_records(skip: int = 0, limit: int = 12, search: str = "", db: Session = Depends(get_db)):
    # Only return records from child nodes (second level — parent_id IS NOT NULL)
    base = (
        "FROM scraped_records sr "
        "JOIN url_nodes un ON sr.url_node_id = un.id "
        "WHERE un.parent_id IS NOT NULL"
    )
    if search:
        rows = db.execute(
            text(f"SELECT sr.id, sr.developer_id, sr.data, sr.scraped_at {base} AND sr.data::text ILIKE :q ORDER BY sr.scraped_at DESC LIMIT :lim OFFSET :skip"),
            {"q": f"%{search}%", "lim": limit, "skip": skip},
        ).fetchall()
        total = db.execute(
            text(f"SELECT COUNT(*) {base} AND sr.data::text ILIKE :q"),
            {"q": f"%{search}%"},
        ).scalar()
    else:
        rows = db.execute(
            text(f"SELECT sr.id, sr.developer_id, sr.data, sr.scraped_at {base} ORDER BY sr.scraped_at DESC LIMIT :lim OFFSET :skip"),
            {"lim": limit, "skip": skip},
        ).fetchall()
        total = db.execute(text(f"SELECT COUNT(*) {base}")).scalar()

    items = [
        {
            "id": str(r[0]),
            "developer_id": str(r[1]),
            "data": dict(r[2]) if r[2] else {},
            "scraped_at": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]
    return {"total": total or 0, "items": items}
