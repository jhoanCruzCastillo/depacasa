from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base


class UrlNode(Base):
    """URL node in recursive tree structure (padre -> hijo -> nieta, etc)"""
    __tablename__ = "url_nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    developer_id = Column(UUID(as_uuid=True), ForeignKey("developers.id"), nullable=False, index=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("url_nodes.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    url = Column(String(2000), nullable=False)
    container_selector = Column(String(1000), nullable=True)
    order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    developer = relationship("Developer", back_populates="url_nodes")
    parent = relationship("UrlNode", remote_side=[id], backref="children")
    fields = relationship("Field", back_populates="url_node", cascade="all, delete-orphan")
    scraped_records = relationship("ScrapedRecord", back_populates="url_node", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<UrlNode(id={self.id}, name={self.name}, url={self.url})>"
