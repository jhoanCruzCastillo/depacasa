import uuid
from sqlalchemy import Column, String, Integer, Float, JSON, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_user_id = Column(UUID(as_uuid=True), ForeignKey("site_users.id", ondelete="CASCADE"),
                          nullable=False, unique=True)
    location = Column(String, nullable=True)
    bedrooms = Column(Integer, nullable=True)
    min_price = Column(Float, nullable=True)
    max_price = Column(Float, nullable=True)
    features = Column(JSON, nullable=True)   # list[str]
    keywords = Column(JSON, nullable=True)   # list[str]
    raw_description = Column(String, nullable=True)
    # Canonical V2 preferences contract (6 parameters with mode + value).
    preferences_v2 = Column(JSON, nullable=True)
    # Consolidated persistent context outside preferences (budget/profile/signals/memory).
    context = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
