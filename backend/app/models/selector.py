from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base


class Selector(Base):
    """DOM selector chain for field extraction"""
    __tablename__ = "selectors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_id = Column(UUID(as_uuid=True), ForeignKey("fields.id"), nullable=False, index=True)
    value = Column(String(1000), nullable=False)
    order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    field = relationship("Field", back_populates="selectors")

    def __repr__(self):
        return f"<Selector(id={self.id}, value={self.value})>"
