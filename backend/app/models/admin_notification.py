import uuid
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base


class AdminNotification(Base):
    """System event notifications shown in the admin panel bell."""
    __tablename__ = "admin_notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Event type: user_registered | document_uploaded | scrape_error
    type = Column(String(50), nullable=False, index=True)
    title = Column(Text, nullable=False)
    body = Column(Text, nullable=True)

    # What triggered this notification
    reference_id = Column(UUID(as_uuid=True), nullable=True)
    reference_type = Column(String(50), nullable=True)  # site_user | user_document | scrape_job

    is_read = Column(Boolean, nullable=False, default=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
