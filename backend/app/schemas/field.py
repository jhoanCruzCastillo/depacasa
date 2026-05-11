from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Optional


class FieldCreate(BaseModel):
    """Create a new field"""
    url_node_id: UUID
    name: str = Field(..., min_length=1, max_length=255)
    is_child_url: bool = False
    plain_text: bool = False
    is_shared: bool = False
    is_list: bool = False
    list_container: Optional[str] = None
    is_image: bool = False
    extract_attr: Optional[str] = None
    order: int = 0


class FieldUpdate(BaseModel):
    """Update field"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    is_child_url: Optional[bool] = None
    plain_text: Optional[bool] = None
    is_shared: Optional[bool] = None
    is_list: Optional[bool] = None
    list_container: Optional[str] = None
    is_image: Optional[bool] = None
    extract_attr: Optional[str] = None
    order: Optional[int] = None


class FieldResponse(BaseModel):
    """Field response"""
    id: UUID
    url_node_id: UUID
    name: str
    is_child_url: bool
    plain_text: bool
    is_shared: bool
    is_list: bool
    list_container: Optional[str]
    is_image: bool
    extract_attr: Optional[str]
    order: int
    created_at: datetime
    inherited_from: Optional[UUID] = None

    class Config:
        from_attributes = True
