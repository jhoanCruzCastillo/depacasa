from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from typing import Optional

from app.models.scrape_job import JobStatus


class ScrapeJobResponse(BaseModel):
    """Scrape job response"""
    id: UUID
    developer_id: UUID
    status: JobStatus
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    total_records: int
    error_log: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
