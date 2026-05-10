from pydantic import BaseModel, Field, HttpUrl
from uuid import UUID
from datetime import datetime
from typing import Optional

from app.models.developer import DeveloperSource


class DeveloperCreate(BaseModel):
    """Create a new developer"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    base_url: str = Field(..., max_length=2000)
    logo_url: Optional[str] = Field(None, max_length=2000)
    source: DeveloperSource = DeveloperSource.MANUAL


class DeveloperUpdate(BaseModel):
    """Update developer"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    base_url: Optional[str] = Field(None, max_length=2000)
    logo_url: Optional[str] = Field(None, max_length=2000)


class DeveloperResponse(BaseModel):
    """Developer response"""
    id: UUID
    name: str
    description: Optional[str]
    base_url: str
    logo_url: Optional[str]
    source: DeveloperSource
    created_at: datetime

    class Config:
        from_attributes = True
