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
    "hero_record_ids": [],
    "featured_enabled": True,
    "featured_title": "Proyectos destacados",
    "featured_level": 2,
    "featured_limit": 6,
    "featured_field_keys": [],
    "catalog_enabled": True,
    "catalog_title": "Propiedades disponibles",
    "catalog_level": 2,
    "catalog_columns": "3",
    "catalog_field_keys": [],
    "footer_text": "© 2025 Portal Inmobiliario",
    "footer_contact": None,
    "card_fields": DEFAULT_CARD_FIELDS,
    "chatbot_enabled": True,
    "chatbot_button_label": "¿Necesitas ayuda?",
}


def _get_cfg(db: Session) -> SiteConfig | None:
    return db.query(SiteConfig).filter(SiteConfig.id == DEFAULT_SITE_CONFIG_ID).first()


def _level_join(level: int) -> str:
    if level == 1:
        return "JOIN url_nodes un ON sr.url_node_id = un.id WHERE un.parent_id IS NULL"
    elif level == 2:
        return "JOIN url_nodes un ON sr.url_node_id = un.id WHERE un.parent_id IS NOT NULL"
    return "JOIN url_nodes un ON sr.url_node_id = un.id WHERE 1=1"


@router.get("/config")
def public_config(db: Session = Depends(get_db)):
    cfg = _get_cfg(db)
    if not cfg:
        return _DEFAULTS
    result = {}
    for k, default in _DEFAULTS.items():
        val = getattr(cfg, k, None)
        result[k] = val if val is not None else default
    return result


@router.get("/records")
def public_records(
    skip: int = 0,
    limit: int = 12,
    search: str = "",
    level: int = 2,
    db: Session = Depends(get_db),
):
    join_where = _level_join(level)
    params: dict = {"lim": limit, "skip": skip}

    if search:
        sql = text(
            f"SELECT sr.id, sr.developer_id, sr.data, sr.scraped_at FROM scraped_records sr "
            f"{join_where} AND sr.data::text ILIKE :q ORDER BY sr.scraped_at DESC LIMIT :lim OFFSET :skip"
        )
        count_sql = text(f"SELECT COUNT(*) FROM scraped_records sr {join_where} AND sr.data::text ILIKE :q")
        params["q"] = f"%{search}%"
    else:
        sql = text(
            f"SELECT sr.id, sr.developer_id, sr.data, sr.scraped_at FROM scraped_records sr "
            f"{join_where} ORDER BY sr.scraped_at DESC LIMIT :lim OFFSET :skip"
        )
        count_sql = text(f"SELECT COUNT(*) FROM scraped_records sr {join_where}")

    rows = db.execute(sql, params).fetchall()
    count_params = {k: v for k, v in params.items() if k not in ("lim", "skip")}
    total = db.execute(count_sql, count_params).scalar() or 0

    items = [
        {
            "id": str(r[0]),
            "developer_id": str(r[1]),
            "data": dict(r[2]) if r[2] else {},
            "scraped_at": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]
    return {"total": int(total), "items": items}


@router.get("/hero")
def public_hero(db: Session = Depends(get_db)):
    """Return records to show in the hero carousel."""
    cfg = _get_cfg(db)
    record_ids = (cfg.hero_record_ids if cfg else None) or []

    if record_ids:
        from uuid import UUID
        from app.models.scraped_record import ScrapedRecord

        try:
            uuids = [UUID(rid) for rid in record_ids if rid]
        except ValueError:
            uuids = []

        records = db.query(ScrapedRecord).filter(ScrapedRecord.id.in_(uuids)).all() if uuids else []
        # Preserve the admin-defined order
        order_map = {str(r.id): i for i, r in enumerate(records)}
        records.sort(key=lambda r: order_map.get(str(r.id), 999))
        return [{"id": str(r.id), "data": dict(r.data) if r.data else {}} for r in records]

    # Fallback: return first N records from the featured level
    level = (cfg.featured_level if cfg else None) or 2
    limit = min((cfg.featured_limit if cfg else None) or 6, 10)
    join_where = _level_join(level)
    rows = db.execute(
        text(f"SELECT sr.id, sr.data FROM scraped_records sr {join_where} ORDER BY sr.scraped_at DESC LIMIT :lim"),
        {"lim": limit},
    ).fetchall()
    return [{"id": str(r[0]), "data": dict(r[1]) if r[1] else {}} for r in rows]


@router.get("/featured")
def public_featured(db: Session = Depends(get_db)):
    """Return featured section records (limited count, configured level)."""
    cfg = _get_cfg(db)
    level = (cfg.featured_level if cfg else None) or 2
    limit = (cfg.featured_limit if cfg else None) or 6
    join_where = _level_join(level)

    rows = db.execute(
        text(
            f"SELECT sr.id, sr.developer_id, sr.data, sr.scraped_at FROM scraped_records sr "
            f"{join_where} ORDER BY sr.scraped_at DESC LIMIT :lim"
        ),
        {"lim": limit},
    ).fetchall()

    return [
        {
            "id": str(r[0]),
            "developer_id": str(r[1]),
            "data": dict(r[2]) if r[2] else {},
            "scraped_at": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]
