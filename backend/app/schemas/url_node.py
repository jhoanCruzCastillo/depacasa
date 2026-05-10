from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Optional


class UrlNodeCreate(BaseModel):
    """Create a new URL node"""
    developer_id: UUID
    parent_id: Optional[UUID] = None
    name: str = Field(..., min_length=1, max_length=255)
    url: str = Field(..., max_length=2000)
    container_selector: Optional[str] = Field(None, max_length=1000)
    order: int = 0


class UrlNodeUpdate(BaseModel):
    """Update URL node"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    url: Optional[str] = Field(None, max_length=2000)
    container_selector: Optional[str] = Field(None, max_length=1000)
    order: Optional[int] = None


class UrlNodeResponse(BaseModel):
    """URL node response"""
    id: UUID
    developer_id: UUID
    parent_id: Optional[UUID]
    name: str
    url: str
    container_selector: Optional[str]
    order: int
    created_at: datetime

    class Config:
        from_attributes = True
