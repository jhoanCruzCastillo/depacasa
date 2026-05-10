from sqlalchemy import Column, String, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum
import uuid

from database import Base


class RecordStatus(str, Enum):
    """Status of scraped record"""
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


class ScrapedRecord(Base):
    """Record extracted from a URL"""
    __tablename__ = "scraped_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    developer_id = Column(UUID(as_uuid=True), ForeignKey("developers.id"), nullable=False, index=True)
    url_node_id = Column(UUID(as_uuid=True), ForeignKey("url_nodes.id"), nullable=False, index=True)
    source_url = Column(String(2000), nullable=False)
    data = Column(JSONB, default=dict)
    status = Column(SQLEnum(RecordStatus), default=RecordStatus.SUCCESS)
    scraped_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    developer = relationship("Developer", back_populates="scraped_records")
    url_node = relationship("UrlNode", back_populates="scraped_records")

    def __repr__(self):
        return f"<ScrapedRecord(id={self.id}, source_url={self.source_url})>"
