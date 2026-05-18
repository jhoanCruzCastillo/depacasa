"""Public-facing API — no authentication required."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from uuid import UUID

from database import get_db
from app.models.site_config import SiteConfig, DEFAULT_SITE_CONFIG_ID, DEFAULT_CARD_FIELDS
from app.models.developer import Developer
from app.models.scraped_record import ScrapedRecord
from app.models.template import ExtractionTemplate

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
    level_filter = _level_filter_sql(level)
    params: dict = {"lim": limit, "skip": skip}

    if search:
        sql = text(
            f"SELECT sr.id, sr.developer_id, sr.data, sr.scraped_at FROM scraped_records sr "
            f"WHERE {level_filter} AND sr.data::text ILIKE :q ORDER BY sr.scraped_at DESC LIMIT :lim OFFSET :skip"
        )
        count_sql = text(f"SELECT COUNT(*) FROM scraped_records sr WHERE {level_filter} AND sr.data::text ILIKE :q")
        params["q"] = f"%{search}%"
    else:
        sql = text(
            f"SELECT sr.id, sr.developer_id, sr.data, sr.scraped_at FROM scraped_records sr "
            f"WHERE {level_filter} ORDER BY sr.scraped_at DESC LIMIT :lim OFFSET :skip"
        )
        count_sql = text(f"SELECT COUNT(*) FROM scraped_records sr WHERE {level_filter}")

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
    """Return records grouped by developer and project (parent node), with inherited parent fields."""
    # Build node maps from JSON templates
    templates = db.query(ExtractionTemplate).all()
    dev_nodes: dict = {str(t.developer_id): list(t.nodes or []) for t in templates}

    developers = db.query(Developer).all()
    result_developers = []

    for dev in developers:
        nodes = dev_nodes.get(str(dev.id), [])
        if not nodes:
            continue

        root_nodes = sorted([n for n in nodes if not n.get("parent_id")], key=lambda n: n.get("order", 0))
        child_nodes_by_parent: dict = {}
        for n in nodes:
            if n.get("parent_id"):
                child_nodes_by_parent.setdefault(n["parent_id"], []).append(n)

        dev_result = {"id": str(dev.id), "name": dev.name, "projects": [], "loose_properties": []}

        for project_node in root_nodes:
            project_obj = {"id": project_node["id"], "name": project_node["name"], "records": []}

            shared_field_names = {
                f["name"] for f in (project_node.get("fields") or []) if f.get("is_shared")
            }

            parent_records = (
                db.query(ScrapedRecord)
                .filter(ScrapedRecord.url_node_id == project_node["id"])
                .order_by(ScrapedRecord.scraped_at.desc())
                .all()
            )

            for child_node in child_nodes_by_parent.get(project_node["id"], []):
                child_records = (
                    db.query(ScrapedRecord)
                    .filter(ScrapedRecord.url_node_id == child_node["id"])
                    .order_by(ScrapedRecord.scraped_at.desc())
                    .all()
                )
                for child_rec in child_records:
                    if search and search.lower() not in str(child_rec.data).lower():
                        continue
                    child_data = dict(child_rec.data) if child_rec.data else {}
                    if parent_records and shared_field_names:
                        for parent_rec in parent_records:
                            parent_data = dict(parent_rec.data) if parent_rec.data else {}
                            for fname in shared_field_names:
                                if fname in parent_data and fname not in child_data:
                                    child_data[fname] = parent_data[fname]
                                    break
                    most_recent_parent = parent_records[0] if parent_records else None
                    project_obj["records"].append({
                        "id": str(child_rec.id),
                        "data": child_data,
                        "parent_data": dict(most_recent_parent.data) if most_recent_parent and most_recent_parent.data else {},
                        "scraped_at": child_rec.scraped_at.isoformat() if child_rec.scraped_at else None,
                    })

            if project_obj["records"]:
                dev_result["projects"].append(project_obj)

            for rec in parent_records:
                if search and search.lower() not in str(rec.data).lower():
                    continue
                dev_result["loose_properties"].append({
                    "id": str(rec.id),
                    "data": dict(rec.data) if rec.data else {},
                    "scraped_at": rec.scraped_at.isoformat() if rec.scraped_at else None,
                })

        if dev_result["projects"] or dev_result["loose_properties"]:
            result_developers.append(dev_result)

    return {"developers": result_developers}


@router.get("/catalog")
def public_catalog(
    skip: int = 0,
    limit: int = 12,
    search: str = "",
    location: str = "",
    project_id: str = "",
    db: Session = Depends(get_db),
):
    """Paginated child records with parent data merged. Returns filter options too."""
    import json
    from collections import defaultdict

    templates = db.query(ExtractionTemplate).all()
    all_nodes: list = [node for t in templates for node in (t.nodes or [])]

    child_nodes = [n for n in all_nodes if n.get("parent_id")]
    if not child_nodes:
        return {"total": 0, "items": [], "locations": [], "projects": []}

    parent_node_ids = list({n["parent_id"] for n in child_nodes})
    parent_nodes_map = {n["id"]: n for n in all_nodes if n["id"] in parent_node_ids}

    # Template field names per parent node — these always override child values
    parent_field_names: dict = defaultdict(set)
    for pnode in parent_nodes_map.values():
        for f in (pnode.get("fields") or []):
            parent_field_names[pnode["id"]].add(f["name"])

    # Most recent parent record per parent node
    parent_records_map: dict = {}
    for pid in parent_node_ids:
        rec = (
            db.query(ScrapedRecord)
            .filter(ScrapedRecord.url_node_id == pid)
            .order_by(ScrapedRecord.scraped_at.desc())
            .first()
        )
        if rec:
            parent_records_map[pid] = rec

    all_items: list = []
    all_locations: set = set()
    all_projects: dict = {}

    for child_node in child_nodes:
        parent_id = child_node["parent_id"]
        parent_node = parent_nodes_map.get(parent_id)
        if not parent_node:
            continue

        pfields = parent_field_names.get(parent_id, set())
        parent_rec = parent_records_map.get(parent_id)
        parent_data = dict(parent_rec.data) if parent_rec and parent_rec.data else {}

        all_projects[str(parent_id)] = parent_node["name"]

        child_recs = (
            db.query(ScrapedRecord)
            .filter(ScrapedRecord.url_node_id == child_node["id"])
            .order_by(ScrapedRecord.scraped_at.desc())
            .all()
        )

        for child_rec in child_recs:
            child_data = dict(child_rec.data) if child_rec.data else {}

            merged = {**child_data}
            for fname, fval in parent_data.items():
                if fval is None:
                    continue
                if pfields and fname in pfields:
                    merged[fname] = fval
                else:
                    cv = merged.get(fname)
                    empty = (
                        cv is None
                        or (isinstance(cv, list) and not cv)
                        or (isinstance(cv, str) and not cv.strip())
                    )
                    if empty:
                        merged[fname] = fval

            loc = ""
            for k in ("ubicacion", "ubicación", "location", "distrito", "ciudad", "zona"):
                v = merged.get(k)
                if v and isinstance(v, str) and v.strip():
                    loc = v.strip()
                    break
            if loc:
                all_locations.add(loc)

            all_items.append({
                "id": str(child_rec.id),
                "data": merged,
                "project_id": str(parent_id),
                "project_name": parent_node["name"],
                "developer_id": str(child_rec.developer_id) if child_rec.developer_id else None,
                "scraped_at": child_rec.scraped_at.isoformat() if child_rec.scraped_at else None,
                "_loc": loc,
            })

    filtered = all_items
    if location:
        filtered = [i for i in filtered if location.lower() in i["_loc"].lower()]
    if project_id:
        filtered = [i for i in filtered if i["project_id"] == project_id]
    if search:
        s = search.lower()
        filtered = [
            i for i in filtered
            if s in json.dumps(i["data"], ensure_ascii=False).lower()
            or s in i["project_name"].lower()
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

    # Fallback: return parent-level (project) records — they have the richest images/data
    rows = db.execute(
        text(
            "SELECT sr.id, sr.data FROM scraped_records sr "
            f"WHERE {_level_filter_sql(1)} "
            "ORDER BY sr.scraped_at DESC LIMIT :lim"
        ),
        {"lim": 6},
    ).fetchall()
    return [{"id": str(r[0]), "data": dict(r[1]) if r[1] else {}} for r in rows]


@router.get("/featured")
def public_featured(db: Session = Depends(get_db)):
    """Return featured section records (limited count, configured level)."""
    cfg = _get_cfg(db)
    level = (cfg.featured_level if cfg else None) or 2
    limit = (cfg.featured_limit if cfg else None) or 6
    level_filter = _level_filter_sql(level)

    rows = db.execute(
        text(
            f"SELECT sr.id, sr.developer_id, sr.data, sr.scraped_at FROM scraped_records sr "
            f"WHERE {level_filter} ORDER BY sr.scraped_at DESC LIMIT :lim"
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
