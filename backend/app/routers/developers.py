from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional, List
from pydantic import BaseModel

import uuid as _uuid
from datetime import datetime

from database import get_db
from app.models import Developer, ExtractionTemplate, ScrapedRecord
from app.models.developer import DeveloperSource
from app.models.proyecto import Proyecto
from app.models.propiedad import Propiedad
from app.schemas import DeveloperCreate, DeveloperUpdate, DeveloperResponse

router = APIRouter(prefix="/api/developers", tags=["developers"])


class DeveloperBulkItem(BaseModel):
    name: str
    base_url: str
    description: Optional[str] = None
    logo_url: Optional[str] = None
    source: DeveloperSource = DeveloperSource.TAVILY


class TemplateSelectorIn(BaseModel):
    value: str
    order: int = 0


class TemplateFieldIn(BaseModel):
    name: str
    is_child_url: bool = False
    plain_text: bool = False
    is_shared: bool = False
    is_list: bool = False
    list_container: Optional[str] = None
    is_image: bool = False
    extract_attr: Optional[str] = None
    order: int = 0
    selectors: List[TemplateSelectorIn] = []


class TemplateNodeIn(BaseModel):
    client_id: str
    parent_client_id: Optional[str] = None
    name: str
    url: str
    container_selector: Optional[str] = None
    order: int = 0
    fields: List[TemplateFieldIn] = []


class TemplateSave(BaseModel):
    nodes: List[TemplateNodeIn]


@router.post("", response_model=DeveloperResponse, status_code=status.HTTP_201_CREATED)
async def create_developer(
    developer: DeveloperCreate,
    db: Session = Depends(get_db),
):
    existing = db.query(Developer).filter(Developer.name == developer.name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Developer with name '{developer.name}' already exists"
        )
    db_developer = Developer(**developer.dict())
    db.add(db_developer)
    db.commit()
    db.refresh(db_developer)
    return db_developer


@router.post("/bulk", response_model=list[DeveloperResponse], status_code=status.HTTP_201_CREATED)
async def bulk_create_developers(
    items: List[DeveloperBulkItem],
    db: Session = Depends(get_db),
):
    created = []
    for item in items:
        if db.query(Developer).filter(Developer.base_url == item.base_url).first():
            continue
        if db.query(Developer).filter(Developer.name == item.name).first():
            continue
        dev = Developer(
            name=item.name,
            base_url=item.base_url,
            description=item.description,
            logo_url=item.logo_url,
            source=item.source,
        )
        db.add(dev)
        created.append(dev)
    db.commit()
    for dev in created:
        db.refresh(dev)
    return created


@router.get("", response_model=list[DeveloperResponse])
async def list_developers(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Developer)
    if search:
        q = q.filter(Developer.name.ilike(f"%{search}%"))
    developers = q.order_by(Developer.created_at.desc()).offset(skip).limit(limit).all()
    return developers


@router.get("/{developer_id}", response_model=DeveloperResponse)
async def get_developer(
    developer_id: UUID,
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")
    return developer


@router.put("/{developer_id}", response_model=DeveloperResponse)
@router.patch("/{developer_id}", response_model=DeveloperResponse)
async def update_developer(
    developer_id: UUID,
    developer_update: DeveloperUpdate,
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")
    update_data = developer_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(developer, field, value)
    db.commit()
    db.refresh(developer)
    return developer


@router.delete("/{developer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_developer(
    developer_id: UUID,
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")
    db.delete(developer)
    db.commit()


@router.get("/{developer_id}/url-nodes")
async def get_developer_url_nodes(
    developer_id: UUID,
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")
    tmpl = db.query(ExtractionTemplate).filter(ExtractionTemplate.developer_id == developer_id).first()
    nodes = tmpl.nodes if tmpl else []
    return [{"id": n["id"], "name": n["name"], "url": n.get("url", ""), "parent_id": n.get("parent_id"), "order": n.get("order", 0)} for n in nodes]


@router.get("/{developer_id}/records")
async def get_developer_records(
    developer_id: UUID,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    proyectos_q = db.query(Proyecto).filter(Proyecto.developer_id == developer_id)
    propiedades_q = (
        db.query(Propiedad)
        .join(Proyecto, Propiedad.proyecto_id == Proyecto.id)
        .filter(Proyecto.developer_id == developer_id)
    )

    result = []
    for r in proyectos_q.order_by(Proyecto.scraped_at.desc()).all():
        result.append({
            "id": str(r.id),
            "data": r.to_data(),
            "status": r.status.value if r.status else None,
            "scraped_at": r.scraped_at.isoformat(),
            "type": "proyecto",
        })
    for r in propiedades_q.order_by(Propiedad.scraped_at.desc()).offset(skip).limit(limit).all():
        result.append({
            "id": str(r.id),
            "proyecto_id": str(r.proyecto_id) if r.proyecto_id else None,
            "data": r.to_data(),
            "status": r.status.value if r.status else None,
            "scraped_at": r.scraped_at.isoformat(),
            "type": "propiedad",
        })
    return result


@router.delete("/{developer_id}/records", status_code=status.HTTP_204_NO_CONTENT)
async def delete_developer_records(
    developer_id: UUID,
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")

    # propiedades cascade via proyectos (ON DELETE CASCADE), so deleting proyectos is enough
    db.query(Proyecto).filter(Proyecto.developer_id == developer_id).delete(synchronize_session=False)
    db.commit()


def _is_uuid(s: str) -> bool:
    try:
        _uuid.UUID(s)
        return True
    except (ValueError, AttributeError):
        return False


def _nodes_with_inherited_fields(nodes: list) -> list:
    """Compute inherited fields at query time: child nodes get shared fields from their parent."""
    node_map = {n["id"]: n for n in nodes}
    result = []
    for node in nodes:
        fields = list(node.get("fields") or [])
        if node.get("parent_id") and node["parent_id"] in node_map:
            parent      = node_map[node["parent_id"]]
            child_names = {f["name"] for f in fields}
            for pf in (parent.get("fields") or []):
                if pf.get("is_shared") and pf["name"] not in child_names:
                    fields.append({**pf, "inherited_from": node["parent_id"]})
        result.append({**node, "fields": fields})
    return result


@router.get("/{developer_id}/template")
async def get_developer_template(developer_id: UUID, db: Session = Depends(get_db)):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")
    tmpl = db.query(ExtractionTemplate).filter(ExtractionTemplate.developer_id == developer_id).first()
    nodes = _nodes_with_inherited_fields(tmpl.nodes if tmpl else [])
    return {"developer_id": str(developer_id), "nodes": nodes}


@router.post("/{developer_id}/template")
async def save_developer_template(
    developer_id: UUID,
    template: TemplateSave,
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")

    # Resolve client_id → stable UUID (preserve if already a real UUID, generate otherwise)
    id_map: dict = {}
    ordered = sorted(template.nodes, key=lambda n: (0 if n.parent_client_id is None else 1))
    for node_in in ordered:
        id_map[node_in.client_id] = node_in.client_id if _is_uuid(node_in.client_id) else str(_uuid.uuid4())

    nodes_json = []
    for node_in in ordered:
        node_id   = id_map[node_in.client_id]
        parent_id = id_map.get(node_in.parent_client_id) if node_in.parent_client_id else None
        fields = []
        for f in node_in.fields:
            fields.append({
                "id":             str(_uuid.uuid4()),
                "name":           f.name.strip().lower(),
                "is_child_url":   f.is_child_url,
                "plain_text":     f.plain_text,
                "is_shared":      f.is_shared,
                "is_list":        f.is_list,
                "list_container": f.list_container or None,
                "is_image":       f.is_image,
                "extract_attr":   f.extract_attr or None,
                "order":          f.order,
                "selectors":      [{"value": s.value, "order": s.order} for s in f.selectors],
                "inherited_from": None,
            })
        nodes_json.append({
            "id":                 node_id,
            "parent_id":          parent_id,
            "name":               node_in.name,
            "url":                node_in.url,
            "container_selector": node_in.container_selector or None,
            "order":              node_in.order,
            "fields":             sorted(fields, key=lambda x: x["order"]),
        })

    tmpl = db.query(ExtractionTemplate).filter(ExtractionTemplate.developer_id == developer_id).first()
    if tmpl:
        tmpl.nodes      = nodes_json
        tmpl.updated_at = datetime.utcnow()
    else:
        db.add(ExtractionTemplate(developer_id=developer_id, nodes=nodes_json))
    db.commit()
    return {"status": "saved", "developer_id": str(developer_id)}
