import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base


class SiteUser(Base):
    __tablename__ = "site_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    name = Column(String, nullable=True)
    country = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    whatsapp = Column(String, nullable=True)
    wants_newsletter = Column(Boolean, default=False)
    role = Column(String(20), nullable=False, server_default="USER")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Manual document validation: pending | approved | rejected
    financial_doc_status = Column(String(20), nullable=True, default=None)
    financial_doc_notes = Column(Text, nullable=True, default=None)
    financial_doc_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    financial_doc_reviewed_by = Column(String(200), nullable=True)
