from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Dict, Any

from app.models.scraped_record import RecordStatus


class ScrapedRecordResponse(BaseModel):
    """Scraped record response"""
    id: UUID
    developer_id: UUID
    url_node_id: UUID
    source_url: str
    data: Dict[str, Any]
    status: RecordStatus
    scraped_at: datetime

    class Config:
        from_attributes = True
