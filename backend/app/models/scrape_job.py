from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum
import uuid

from database import Base


class JobStatus(str, Enum):
    """Status of scrape job"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ScrapeJob(Base):
    """Scraping job execution record"""
    __tablename__ = "scrape_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    developer_id = Column(UUID(as_uuid=True), ForeignKey("developers.id"), nullable=False, index=True)
    status = Column(SQLEnum(JobStatus), default=JobStatus.PENDING)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    total_records = Column(Integer, default=0)
    error_log = Column(String(5000), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    developer = relationship("Developer", back_populates="scrape_jobs")

    def __repr__(self):
        return f"<ScrapeJob(id={self.id}, status={self.status})>"
