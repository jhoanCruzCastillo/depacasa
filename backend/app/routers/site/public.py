"""Public-facing API — no authentication required."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from uuid import UUID

from database import get_db
from app.models.site_config import SiteConfig, DEFAULT_SITE_CONFIG_ID, DEFAULT_CARD_FIELDS
from app.models.developer import Developer
from app.models.url_node import UrlNode
from app.models.scraped_record import ScrapedRecord
from app.models.field import Field

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


@router.get("/records/grouped")
def public_records_grouped(
    search: str = "",
    db: Session = Depends(get_db),
):
    """Return records grouped by developer and project (parent url_node), with inherited parent fields."""
    from app.models.field import Field
    
    # Get all developers
    developers = db.query(Developer).all()
    result_developers = []
    
    for dev in developers:
        # Get all url_nodes for this developer
        root_nodes = db.query(UrlNode).filter(
            UrlNode.developer_id == dev.id,
            UrlNode.parent_id == None
        ).order_by(UrlNode.order).all()
        
        dev_result = {
            "id": str(dev.id),
            "name": dev.name,
            "projects": [],
            "loose_properties": []
        }
        
        # For each root node (project), get its child nodes' records and merge with parent data
        for project_node in root_nodes:
            project_obj = {
                "id": str(project_node.id),
                "name": project_node.name,
                "records": []
            }
            
            # Get child nodes of this project
            child_nodes = db.query(UrlNode).filter(
                UrlNode.parent_id == project_node.id
            ).all()
            
            # Get shared fields from project ONCE (not per child_node)
            shared_fields = db.query(Field).filter(
                Field.url_node_id == project_node.id,
                Field.is_shared == True
            ).all()
            shared_field_names = {f.name for f in shared_fields}
            
            # Get parent records ONCE for this project
            parent_records = db.query(ScrapedRecord).filter(
                ScrapedRecord.url_node_id == project_node.id
            ).order_by(ScrapedRecord.scraped_at.desc()).all()
            
            # For each child node, get its records and merge with parent record data
            for child_node in child_nodes:
                child_records = db.query(ScrapedRecord).filter(
                    ScrapedRecord.url_node_id == child_node.id
                ).order_by(ScrapedRecord.scraped_at.desc()).all()
                
                # For each child record, merge with parent records (match by checking all parents)
                for child_rec in child_records:
                    if search and search.lower() not in str(child_rec.data).lower():
                        continue
                        
                    child_data = dict(child_rec.data) if child_rec.data else {}
                    
                    # Merge shared fields from ALL parent records (use most complete parent)
                    if parent_records and shared_field_names:
                        for parent_rec in parent_records:
                            parent_data = dict(parent_rec.data) if parent_rec.data else {}
                            for fname in shared_field_names:
                                # Only add if not already in child and exists in parent
                                if fname in parent_data and fname not in child_data:
                                    child_data[fname] = parent_data[fname]
                                    break  # Use first parent that has this field
                    
                    # Use the most recent parent record
                    most_recent_parent = parent_records[0] if parent_records else None
                    
                    project_obj["records"].append({
                        "id": str(child_rec.id),
                        "data": child_data,
                        "parent_data": dict(most_recent_parent.data) if most_recent_parent and most_recent_parent.data else {},
                        "scraped_at": child_rec.scraped_at.isoformat() if child_rec.scraped_at else None
                    })
            
            # Only add project if it has records
            if project_obj["records"]:
                dev_result["projects"].append(project_obj)
            
            # Also get direct records from root node (loose properties under this project)
            root_records = db.query(ScrapedRecord).filter(
                ScrapedRecord.url_node_id == project_node.id
            ).order_by(ScrapedRecord.scraped_at.desc()).all()
            
            for rec in root_records:
                if search and search.lower() not in str(rec.data).lower():
                    continue
                dev_result["loose_properties"].append({
                    "id": str(rec.id),
                    "data": dict(rec.data) if rec.data else {},
                    "scraped_at": rec.scraped_at.isoformat() if rec.scraped_at else None
                })
        
        # Only add developer if it has projects or properties
        if dev_result["projects"] or dev_result["loose_properties"]:
            result_developers.append(dev_result)
    
    return {"developers": result_developers}


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
