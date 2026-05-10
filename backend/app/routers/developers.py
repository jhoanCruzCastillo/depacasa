from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional, List
from pydantic import BaseModel

from database import get_db
from app.models import Developer, UrlNode, Field, Selector, ScrapedRecord
from app.models.developer import DeveloperSource
from app.schemas import DeveloperCreate, DeveloperUpdate, DeveloperResponse
from app.schemas.scraped_record import ScrapedRecordResponse

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
    nodes = db.query(UrlNode).filter(UrlNode.developer_id == developer_id).order_by(UrlNode.order).all()
    return [{"id": str(n.id), "name": n.name, "url": n.url, "parent_id": str(n.parent_id) if n.parent_id else None, "order": n.order} for n in nodes]


@router.get("/{developer_id}/records", response_model=list[ScrapedRecordResponse])
async def get_developer_records(
    developer_id: UUID,
    node_id: Optional[UUID] = Query(None),
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(ScrapedRecord).filter(ScrapedRecord.developer_id == developer_id)
    if node_id:
        q = q.filter(ScrapedRecord.url_node_id == node_id)
    records = q.order_by(ScrapedRecord.scraped_at.desc()).offset(skip).limit(limit).all()
    return records


@router.delete("/{developer_id}/records", status_code=status.HTTP_204_NO_CONTENT)
async def delete_developer_records(
    developer_id: UUID,
    node_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")
    q = db.query(ScrapedRecord).filter(ScrapedRecord.developer_id == developer_id)
    if node_id:
        q = q.filter(ScrapedRecord.url_node_id == node_id)
    q.delete(synchronize_session=False)
    db.commit()


@router.get("/{developer_id}/template")
async def get_developer_template(
    developer_id: UUID,
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")
    nodes = db.query(UrlNode).filter(UrlNode.developer_id == developer_id).order_by(UrlNode.order).all()
    result = []
    for node in nodes:
        fields_data = []
        for f in sorted(node.fields, key=lambda x: x.order):
            selectors_data = [{"id": str(s.id), "value": s.value, "order": s.order} for s in sorted(f.selectors, key=lambda x: x.order)]
            fields_data.append({"id": str(f.id), "name": f.name, "is_child_url": f.is_child_url, "plain_text": f.plain_text, "is_shared": f.is_shared, "is_list": f.is_list, "list_container": f.list_container, "is_image": f.is_image, "extract_attr": f.extract_attr, "order": f.order, "selectors": selectors_data})
        result.append({"id": str(node.id), "name": node.name, "url": node.url, "container_selector": node.container_selector, "parent_id": str(node.parent_id) if node.parent_id else None, "order": node.order, "fields": fields_data})
    return {"developer_id": str(developer_id), "nodes": result}


@router.post("/{developer_id}/template")
async def save_developer_template(
    developer_id: UUID,
    template: TemplateSave,
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")

    # Delete existing tree
    existing_nodes = db.query(UrlNode).filter(UrlNode.developer_id == developer_id).all()
    for node in existing_nodes:
        db.delete(node)
    db.flush()

    # Map client_id -> real DB id
    id_map: dict = {}

    # Two-pass: first roots, then children (topological order by parent presence)
    ordered = sorted(template.nodes, key=lambda n: (0 if n.parent_client_id is None else 1))

    for i, node_in in enumerate(ordered):
        parent_id = id_map.get(node_in.parent_client_id) if node_in.parent_client_id else None
        node = UrlNode(
            developer_id=developer_id,
            parent_id=parent_id,
            name=node_in.name,
            url=node_in.url,
            container_selector=node_in.container_selector,
            order=node_in.order,
        )
        db.add(node)
        db.flush()
        id_map[node_in.client_id] = node.id

        for field_in in node_in.fields:
            field = Field(url_node_id=node.id, name=field_in.name.strip().lower(), is_child_url=field_in.is_child_url, plain_text=field_in.plain_text, is_shared=field_in.is_shared, is_list=field_in.is_list, list_container=field_in.list_container or None, is_image=field_in.is_image, extract_attr=field_in.extract_attr, order=field_in.order)
            db.add(field)
            db.flush()
            for sel_in in field_in.selectors:
                sel = Selector(field_id=field.id, value=sel_in.value, order=sel_in.order)
                db.add(sel)

    db.commit()
    return {"status": "saved", "developer_id": str(developer_id)}
