from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from uuid import UUID

from database import get_db
from app.models import UrlNode, Field, Selector
from app.schemas import (
    UrlNodeCreate, UrlNodeUpdate, UrlNodeResponse,
    FieldCreate, FieldUpdate, FieldResponse,
    SelectorCreate, SelectorUpdate, SelectorResponse,
)

router = APIRouter(prefix="/api/templates", tags=["templates"])


# URL Node endpoints
@router.post("/url-nodes", response_model=UrlNodeResponse, status_code=status.HTTP_201_CREATED)
async def create_url_node(
    node: UrlNodeCreate,
    db: Session = Depends(get_db),
):
    """Create a new URL node"""
    db_node = UrlNode(**node.dict())
    db.add(db_node)
    db.commit()
    db.refresh(db_node)
    return db_node


@router.get("/url-nodes/{node_id}", response_model=UrlNodeResponse)
async def get_url_node(
    node_id: UUID,
    db: Session = Depends(get_db),
):
    """Get a URL node by ID"""
    node = db.query(UrlNode).filter(UrlNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return node


@router.get("/developers/{developer_id}/url-nodes", response_model=list[UrlNodeResponse])
async def list_url_nodes_by_developer(
    developer_id: UUID,
    db: Session = Depends(get_db),
):
    """List all URL nodes for a developer"""
    nodes = db.query(UrlNode).filter(UrlNode.developer_id == developer_id).all()
    return nodes


@router.put("/url-nodes/{node_id}", response_model=UrlNodeResponse)
async def update_url_node(
    node_id: UUID,
    update: UrlNodeUpdate,
    db: Session = Depends(get_db),
):
    """Update a URL node"""
    node = db.query(UrlNode).filter(UrlNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    
    update_data = update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(node, field, value)
    
    db.commit()
    db.refresh(node)
    return node


@router.delete("/url-nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_url_node(
    node_id: UUID,
    db: Session = Depends(get_db),
):
    """Delete a URL node"""
    node = db.query(UrlNode).filter(UrlNode.id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    
    db.delete(node)
    db.commit()


# Field endpoints
@router.get("/fields/suggestions")
async def field_name_suggestions(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """Return up to 10 unique field names (lowercase) matching the prefix."""
    pattern = q.strip().lower() + "%"
    rows = (
        db.query(func.lower(Field.name))
        .filter(func.lower(Field.name).ilike(pattern))
        .distinct()
        .order_by(func.lower(Field.name))
        .limit(10)
        .all()
    )
    return [row[0] for row in rows]


@router.post("/fields", response_model=FieldResponse, status_code=status.HTTP_201_CREATED)
async def create_field(
    field: FieldCreate,
    db: Session = Depends(get_db),
):
    """Create a new field"""
    data = field.dict()
    data["name"] = data["name"].strip().lower()
    db_field = Field(**data)
    db.add(db_field)
    db.commit()
    db.refresh(db_field)
    return db_field


@router.get("/fields/{field_id}", response_model=FieldResponse)
async def get_field(
    field_id: UUID,
    db: Session = Depends(get_db),
):
    """Get a field by ID"""
    field = db.query(Field).filter(Field.id == field_id).first()
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return field


@router.get("/url-nodes/{node_id}/fields", response_model=list[FieldResponse])
async def list_fields_by_node(
    node_id: UUID,
    db: Session = Depends(get_db),
):
    """List all fields for a URL node"""
    fields = db.query(Field).filter(Field.url_node_id == node_id).all()
    return fields


@router.put("/fields/{field_id}", response_model=FieldResponse)
async def update_field(
    field_id: UUID,
    update: FieldUpdate,
    db: Session = Depends(get_db),
):
    """Update a field"""
    field = db.query(Field).filter(Field.id == field_id).first()
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    
    update_data = update.dict(exclude_unset=True)
    if "name" in update_data:
        update_data["name"] = update_data["name"].strip().lower()
    for key, value in update_data.items():
        setattr(field, key, value)
    
    db.commit()
    db.refresh(field)
    return field


@router.delete("/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_field(
    field_id: UUID,
    db: Session = Depends(get_db),
):
    """Delete a field"""
    field = db.query(Field).filter(Field.id == field_id).first()
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    
    db.delete(field)
    db.commit()


# Selector endpoints
@router.post("/selectors", response_model=SelectorResponse, status_code=status.HTTP_201_CREATED)
async def create_selector(
    selector: SelectorCreate,
    db: Session = Depends(get_db),
):
    """Create a new selector"""
    db_selector = Selector(**selector.dict())
    db.add(db_selector)
    db.commit()
    db.refresh(db_selector)
    return db_selector


@router.get("/selectors/{selector_id}", response_model=SelectorResponse)
async def get_selector(
    selector_id: UUID,
    db: Session = Depends(get_db),
):
    """Get a selector by ID"""
    selector = db.query(Selector).filter(Selector.id == selector_id).first()
    if not selector:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return selector


@router.get("/fields/{field_id}/selectors", response_model=list[SelectorResponse])
async def list_selectors_by_field(
    field_id: UUID,
    db: Session = Depends(get_db),
):
    """List all selectors for a field"""
    selectors = db.query(Selector).filter(Selector.field_id == field_id).all()
    return selectors


@router.put("/selectors/{selector_id}", response_model=SelectorResponse)
async def update_selector(
    selector_id: UUID,
    update: SelectorUpdate,
    db: Session = Depends(get_db),
):
    """Update a selector"""
    selector = db.query(Selector).filter(Selector.id == selector_id).first()
    if not selector:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    
    update_data = update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(selector, key, value)
    
    db.commit()
    db.refresh(selector)
    return selector


@router.delete("/selectors/{selector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_selector(
    selector_id: UUID,
    db: Session = Depends(get_db),
):
    """Delete a selector"""
    selector = db.query(Selector).filter(Selector.id == selector_id).first()
    if not selector:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    
    db.delete(selector)
    db.commit()
