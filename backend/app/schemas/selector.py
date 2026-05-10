from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Optional


class SelectorCreate(BaseModel):
    """Create a new selector"""
    field_id: UUID
    value: str = Field(..., min_length=1, max_length=1000)
    order: int = 0


class SelectorUpdate(BaseModel):
    """Update selector"""
    value: Optional[str] = Field(None, min_length=1, max_length=1000)
    order: Optional[int] = None


class SelectorResponse(BaseModel):
    """Selector response"""
    id: UUID
    field_id: UUID
    value: str
    order: int
    created_at: datetime

    class Config:
        from_attributes = True
