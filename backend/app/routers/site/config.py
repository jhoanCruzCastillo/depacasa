"""Admin site configuration endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from database import get_db
from app.models.site_config import SiteConfig, DEFAULT_SITE_CONFIG_ID, DEFAULT_CARD_FIELDS

router = APIRouter()


class CardFieldSchema(BaseModel):
    key: str
    label: str
    type: str  # title | price | text | badge | image | link


class SiteConfigIn(BaseModel):
    site_name: Optional[str] = None
    tagline: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    logo_text: Optional[str] = None
    show_hero: Optional[bool] = None
    hero_title: Optional[str] = None
    hero_subtitle: Optional[str] = None
    hero_cta_text: Optional[str] = None
    hero_bg_color: Optional[str] = None
    show_carousel: Optional[bool] = None
    carousel_title: Optional[str] = None
    carousel_field_image: Optional[str] = None
    show_listing: Optional[bool] = None
    listing_title: Optional[str] = None
    listing_columns: Optional[str] = None
    footer_text: Optional[str] = None
    footer_contact: Optional[str] = None
    card_fields: Optional[List[dict]] = None
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
