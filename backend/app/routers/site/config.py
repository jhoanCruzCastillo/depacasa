"""Admin site configuration endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from app.models.site_config import SiteConfig, DEFAULT_SITE_CONFIG_ID, DEFAULT_CARD_FIELDS
from app.models.proyecto import Proyecto
from app.models.propiedad import Propiedad

router = APIRouter()


class CardFieldSchema(BaseModel):
    key: str
    label: str
    type: str


class SiteConfigIn(BaseModel):
    # General
    site_name: Optional[str] = None
    tagline: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    logo_text: Optional[str] = None
    # Hero text
    show_hero: Optional[bool] = None
    hero_title: Optional[str] = None
    hero_subtitle: Optional[str] = None
    hero_cta_text: Optional[str] = None
    hero_bg_color: Optional[str] = None
    # Hero carousel record IDs
    hero_record_ids: Optional[List[str]] = None
    # Featured section
    featured_enabled: Optional[bool] = None
    featured_title: Optional[str] = None
    featured_level: Optional[int] = None
    featured_limit: Optional[int] = None
    featured_field_keys: Optional[List[str]] = None
    # Catalog section
    catalog_enabled: Optional[bool] = None
    catalog_title: Optional[str] = None
    catalog_level: Optional[int] = None
    catalog_columns: Optional[str] = None
    catalog_field_keys: Optional[List[str]] = None
    # Footer
    footer_text: Optional[str] = None
    footer_contact: Optional[str] = None
    # Legacy card fields (kept for backward compat)
    card_fields: Optional[List[dict]] = None
    # Chatbot
    chatbot_enabled: Optional[bool] = None
    chatbot_greeting: Optional[str] = None
    chatbot_button_label: Optional[str] = None


def _get_or_create(db: Session) -> SiteConfig:
    cfg = db.query(SiteConfig).filter(SiteConfig.id == DEFAULT_SITE_CONFIG_ID).first()
    if not cfg:
        cfg = SiteConfig(id=DEFAULT_SITE_CONFIG_ID, card_fields=list(DEFAULT_CARD_FIELDS))
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


@router.get("/config")
def get_config(db: Session = Depends(get_db)):
    return _get_or_create(db)


@router.put("/config")
def update_config(body: SiteConfigIn, db: Session = Depends(get_db)):
    cfg = _get_or_create(db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.get("/records/browse")
def browse_records(
    level: int = 2,
    limit: int = 48,
    skip: int = 0,
    search: str = "",
    db: Session = Depends(get_db),
):
    """Return paginated records for admin record browser (to pick hero items)."""
    if level == 1:
        q = db.query(Proyecto)
        if search:
            q = q.filter(
                Proyecto.nombre.ilike(f"%{search}%")
                | Proyecto.ubicacion.ilike(f"%{search}%")
            )
        total = q.count()
        items = q.order_by(Proyecto.scraped_at.desc()).offset(skip).limit(limit).all()
    else:
        q = db.query(Propiedad).join(Proyecto, Propiedad.proyecto_id == Proyecto.id)
        if search:
            q = q.filter(
                Proyecto.nombre.ilike(f"%{search}%")
                | Proyecto.ubicacion.ilike(f"%{search}%")
                | Propiedad.dormitorios.ilike(f"%{search}%")
            )
        total = q.count()
        items = q.order_by(Propiedad.scraped_at.desc()).offset(skip).limit(limit).all()

    return {
        "total": int(total),
        "items": [{"id": str(r.id), "data": r.to_data()} for r in items],
    }


@router.get("/fields/discover")
def discover_fields(level: int = 2, db: Session = Depends(get_db)):
    """Return the standardized field keys available at the given level."""
    if level == 1:
        return sorted([
            "nombre", "estado_del_proyecto", "ubicacion", "precio_desde",
            "imagen", "descripcion", "areas_comunes", "areas_comunes_imagenes",
            "areas_comunes_exterior_e_interior_img", "lugares_cercanos",
        ])
    return sorted([
        "imagen_modelo", "dormitorios", "m2", "modelo", "modelo_imagen",
        # fields merged from proyecto:
        "nombre", "estado_del_proyecto", "ubicacion", "precio_desde",
        "imagen", "descripcion", "areas_comunes", "areas_comunes_imagenes",
        "areas_comunes_exterior_e_interior_img", "lugares_cercanos",
    ])
