"""Public-facing API — no authentication required."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from uuid import UUID

from database import get_db
from app.models.site_config import SiteConfig, DEFAULT_SITE_CONFIG_ID, DEFAULT_CARD_FIELDS
from app.models.proyecto import Proyecto
from app.models.propiedad import Propiedad

router = APIRouter()


def _proyecto_display_name(proy: "Proyecto") -> str:
    """Best available display name for a project (falls back to URL slug)."""
    if proy.nombre:
        return proy.nombre
    url = (proy.extra_data or {}).get("url_propiedad", "") or ""
    if url:
        try:
            from urllib.parse import urlparse
            SKIP = {"proyecto", "projects", "propiedad", "property", "venta", "sale", "en-venta", "departamentos"}
            parts = [p for p in urlparse(url).path.split("/") if p and p.lower() not in SKIP]
            if parts:
                return " ".join(w.capitalize() for w in parts[-1].split("-"))
        except Exception:
            pass
    return ""


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
    if level == 1:
        q = db.query(Proyecto)
        if search:
            q = q.filter(
                Proyecto.nombre.ilike(f"%{search}%")
                | Proyecto.ubicacion.ilike(f"%{search}%")
                | Proyecto.estado_del_proyecto.ilike(f"%{search}%")
            )
        total = q.count()
        items = q.order_by(Proyecto.scraped_at.desc()).offset(skip).limit(limit).all()
        return {
            "total": total,
            "items": [
                {"id": str(r.id), "developer_id": str(r.developer_id), "data": r.to_data(), "scraped_at": r.scraped_at.isoformat()}
                for r in items
            ],
        }
    else:
        q = (
            db.query(Propiedad)
            .join(Proyecto, Propiedad.proyecto_id == Proyecto.id)
        )
        if search:
            q = q.filter(
                Proyecto.nombre.ilike(f"%{search}%")
                | Proyecto.ubicacion.ilike(f"%{search}%")
                | Propiedad.dormitorios.ilike(f"%{search}%")
                | Proyecto.precio_desde.ilike(f"%{search}%")
            )
        total = q.count()
        items = q.order_by(Propiedad.scraped_at.desc()).offset(skip).limit(limit).all()
        return {
            "total": total,
            "items": [
                {"id": str(r.id), "proyecto_id": str(r.proyecto_id) if r.proyecto_id else None, "data": r.to_data(), "scraped_at": r.scraped_at.isoformat()}
                for r in items
            ],
        }


@router.get("/records/grouped")
def public_records_grouped(
    search: str = "",
    db: Session = Depends(get_db),
):
    """Return propiedades grouped by proyecto."""
    proyectos = db.query(Proyecto).order_by(Proyecto.scraped_at.desc()).all()
    result = []

    for proy in proyectos:
        propiedades = (
            db.query(Propiedad)
            .filter(Propiedad.proyecto_id == proy.id)
            .order_by(Propiedad.scraped_at.desc())
            .all()
        )
        records = []
        for prop in propiedades:
            if search and search.lower() not in str(prop.to_data()).lower():
                continue
            merged = proy.to_data()
            merged.update(prop.to_data())
            records.append({
                "id": str(prop.id),
                "data": merged,
                "parent_data": proy.to_data(),
                "scraped_at": prop.scraped_at.isoformat() if prop.scraped_at else None,
            })
        if records or not search:
            result.append({
                "proyecto_id": str(proy.id),
                "proyecto_name": proy.nombre,
                "records": records,
                "proyecto_data": proy.to_data(),
            })

    return {"proyectos": result}


@router.get("/catalog")
def public_catalog(
    skip: int = 0,
    limit: int = 12,
    search: str = "",
    location: str = "",
    project_id: str = "",
    db: Session = Depends(get_db),
):
    """Paginated propiedades with parent proyecto data merged."""
    import json

    propiedades = db.query(Propiedad).order_by(Propiedad.scraped_at.desc()).all()

    all_locations: set = set()
    all_projects: dict = {}
    all_items: list = []

    for prop in propiedades:
        proy = prop.proyecto_obj
        child_data = prop.to_data()

        if proy:
            parent_data = proy.to_data()
            for k, v in parent_data.items():
                if v is None:
                    continue
                cv = child_data.get(k)
                empty = cv is None or (isinstance(cv, list) and not cv) or (isinstance(cv, str) and not cv.strip())
                if empty:
                    child_data[k] = v
            all_projects[str(proy.id)] = _proyecto_display_name(proy)

        loc = child_data.get("ubicacion") or ""
        if isinstance(loc, str) and loc.strip():
            # Normalize newlines for location filter matching
            all_locations.add(loc.split("\n")[0].strip())

        all_items.append({
            "id": str(prop.id),
            "data": child_data,
            "project_id": str(proy.id) if proy else None,
            "project_name": _proyecto_display_name(proy) if proy else None,
            "proyecto_id": str(prop.proyecto_id) if prop.proyecto_id else None,
            "scraped_at": prop.scraped_at.isoformat() if prop.scraped_at else None,
            "_loc": loc.strip().lower() if isinstance(loc, str) else "",
        })

    filtered = all_items
    if location:
        filtered = [i for i in filtered if location.lower() in i["_loc"] or i["_loc"] in location.lower()]
    if project_id:
        filtered = [i for i in filtered if i["project_id"] == project_id]
    if search:
        s = search.lower()
        filtered = [
            i for i in filtered
            if s in json.dumps(i["data"], ensure_ascii=False).lower()
            or (i["project_name"] and s in i["project_name"].lower())
        ]

    for item in all_items + filtered:
        item.pop("_loc", None)

    total = len(filtered)
    paginated = filtered[skip: skip + limit]

    return {
        "total": total,
        "items": paginated,
        "locations": sorted(all_locations),
        "projects": sorted(
            [{"id": pid, "name": name} for pid, name in all_projects.items()],
            key=lambda x: x["name"],
        ),
    }


@router.get("/hero")
def public_hero(db: Session = Depends(get_db)):
    """Return records for the hero carousel."""
    cfg = _get_cfg(db)
    record_ids = (cfg.hero_record_ids if cfg else None) or []

    if record_ids:
        try:
            uuids = [UUID(rid) for rid in record_ids if rid]
        except ValueError:
            uuids = []

        if uuids:
            props = db.query(Propiedad).filter(Propiedad.id.in_(uuids)).all()
            prop_map = {str(p.id): p for p in props}
            proyects = db.query(Proyecto).filter(Proyecto.id.in_(uuids)).all()
            proy_map = {str(p.id): p for p in proyects}

            result = []
            for uid in [str(u) for u in uuids]:
                if uid in prop_map:
                    result.append({"id": uid, "data": prop_map[uid].to_data()})
                elif uid in proy_map:
                    result.append({"id": uid, "data": proy_map[uid].to_data()})
            return result

    # Fallback: top 6 proyectos
    proyectos = db.query(Proyecto).order_by(Proyecto.scraped_at.desc()).limit(6).all()
    return [{"id": str(p.id), "data": p.to_data()} for p in proyectos]


@router.get("/featured")
def public_featured(db: Session = Depends(get_db)):
    """Return featured section records."""
    cfg = _get_cfg(db)
    level = (cfg.featured_level if cfg else None) or 2
    limit = (cfg.featured_limit if cfg else None) or 6

    if level == 1:
        items = db.query(Proyecto).order_by(Proyecto.scraped_at.desc()).limit(limit).all()
    else:
        items = db.query(Propiedad).order_by(Propiedad.scraped_at.desc()).limit(limit).all()

    return [
        {
            "id": str(r.id),
            "developer_id": str(r.developer_id) if hasattr(r, "developer_id") else None,
            "data": r.to_data(),
            "scraped_at": r.scraped_at.isoformat(),
        }
        for r in items
    ]
