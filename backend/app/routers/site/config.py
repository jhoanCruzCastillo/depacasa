"""Admin site configuration endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import json

from database import get_db
from app.models.site_config import SiteConfig, DEFAULT_SITE_CONFIG_ID, DEFAULT_CARD_FIELDS

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


def _level_filter_sql(level: int) -> str:
    if level == 1:
        cond = "(node->>'parent_id') IS NULL"
    elif level == 2:
        cond = "(node->>'parent_id') IS NOT NULL"
    else:
        cond = "TRUE"
    return (
        f"sr.url_node_id::text IN ("
        f"SELECT node->>'id' FROM extraction_templates, jsonb_array_elements(nodes) AS node WHERE {cond}"
        f")"
    )


@router.get("/records/browse")
def browse_records(
    level: int = 2,
    limit: int = 48,
    skip: int = 0,
    search: str = "",
    db: Session = Depends(get_db),
):
    """Return paginated records for admin record browser (to pick hero items)."""
    level_filter = _level_filter_sql(level)
    params: dict = {"lim": limit, "skip": skip}

    if search:
        sql = text(
            f"SELECT sr.id, sr.data FROM scraped_records sr WHERE {level_filter} "
            "AND sr.data::text ILIKE :q ORDER BY sr.scraped_at DESC LIMIT :lim OFFSET :skip"
        )
        count_sql = text(f"SELECT COUNT(*) FROM scraped_records sr WHERE {level_filter} AND sr.data::text ILIKE :q")
        params["q"] = f"%{search}%"
    else:
        sql = text(
            f"SELECT sr.id, sr.data FROM scraped_records sr WHERE {level_filter} "
            "ORDER BY sr.scraped_at DESC LIMIT :lim OFFSET :skip"
        )
        count_sql = text(f"SELECT COUNT(*) FROM scraped_records sr WHERE {level_filter}")

    rows = db.execute(sql, params).fetchall()
    total = db.execute(count_sql, {k: v for k, v in params.items() if k not in ("lim", "skip")}).scalar() or 0

    items = [{"id": str(r[0]), "data": dict(r[1]) if r[1] else {}} for r in rows]
    return {"total": int(total), "items": items}


@router.get("/fields/discover")
def discover_fields(level: int = 2, db: Session = Depends(get_db)):
    """Return unique field keys present in records at the given level (sample of 200 records)."""
    level_filter = _level_filter_sql(level)
    rows = db.execute(
        text(f"SELECT sr.data FROM scraped_records sr WHERE {level_filter} ORDER BY sr.scraped_at DESC LIMIT 200")
    ).fetchall()

    keys: set = set()
    for (data,) in rows:
        if data and isinstance(data, dict):
            keys.update(data.keys())

    return sorted(keys)
