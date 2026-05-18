from sqlalchemy import Column, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base


class ExtractionTemplate(Base):
    """Extraction template stored as a single JSON document per developer."""
    __tablename__ = "extraction_templates"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    developer_id = Column(
        UUID(as_uuid=True),
        ForeignKey("developers.id", ondelete="CASCADE"),
        unique=True, nullable=False, index=True,
    )
    nodes      = Column(JSONB, nullable=False, default=list)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    developer = relationship("Developer", back_populates="extraction_template")
