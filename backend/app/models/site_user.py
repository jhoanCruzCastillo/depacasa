import uuid
from sqlalchemy import Column, String, Boolean, DateTime
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
    wants_newsletter = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
