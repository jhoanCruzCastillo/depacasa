from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from uuid import UUID

from database import get_db
from app.models import ExtractionTemplate

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("/fields/suggestions")
async def field_name_suggestions(q: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    """Return up to 10 unique field names matching the prefix, sourced from stored templates."""
    q_lower = q.strip().lower()
    templates = db.query(ExtractionTemplate).all()
    seen: set = set()
    for tmpl in templates:
        for node in (tmpl.nodes or []):
            for field in (node.get("fields") or []):
                name = (field.get("name") or "").lower()
                if name.startswith(q_lower):
                    seen.add(name)
    return sorted(seen)[:10]


@router.get("/developers/{developer_id}/url-nodes")
async def list_url_nodes_by_developer(developer_id: UUID, db: Session = Depends(get_db)):
    """Return nodes from the stored JSON template (same shape as before)."""
    tmpl = db.query(ExtractionTemplate).filter(ExtractionTemplate.developer_id == developer_id).first()
    if not tmpl:
        return []
    return [
        {
            "id":                 n["id"],
            "name":               n["name"],
            "url":                n.get("url", ""),
            "container_selector": n.get("container_selector"),
            "parent_id":          n.get("parent_id"),
            "order":              n.get("order", 0),
        }
        for n in (tmpl.nodes or [])
    ]
