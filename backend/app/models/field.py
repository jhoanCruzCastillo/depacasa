from sqlalchemy import Column, String, Boolean, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base


class Field(Base):
    """Field to extract from a URL node"""
    __tablename__ = "fields"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    url_node_id = Column(UUID(as_uuid=True), ForeignKey("url_nodes.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    is_child_url = Column(Boolean, default=False)
    plain_text = Column(Boolean, default=False)
    is_shared = Column(Boolean, default=False)
    is_list = Column(Boolean, default=False)
    list_container = Column(String(1000), nullable=True)
    is_image = Column(Boolean, default=False)
    extract_attr = Column(String(100), nullable=True)
    order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    url_node = relationship("UrlNode", back_populates="fields")
    selectors = relationship("Selector", back_populates="field", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Field(id={self.id}, name={self.name})>"
