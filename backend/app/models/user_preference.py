from sqlalchemy import Column, String, Integer, Float, JSON, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base

PRIORITY_REQUIRED = "REQUIRED"
PRIORITY_OPTIONAL = "OPTIONAL"


class UserPreference(Base):
    __tablename__ = "user_preferences"

    site_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("site_users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    location = Column(String, nullable=True)
    location_priority = Column(String, nullable=True)       # REQUIRED | OPTIONAL
    bedrooms = Column(Integer, nullable=True)
    bedrooms_priority = Column(String, nullable=True)
    bathrooms = Column(Integer, nullable=True)
    bathrooms_priority = Column(String, nullable=True)
    min_price = Column(Float, nullable=True)
    min_price_priority = Column(String, nullable=True)
    max_price = Column(Float, nullable=True)
    max_price_priority = Column(String, nullable=True)
    nearby_places = Column(JSON, nullable=True)             # list[str]
    nearby_places_priority = Column(String, nullable=True)
    features = Column(JSON, nullable=True)                  # list[str] — amenities / common areas
    features_priority = Column(String, nullable=True)
    property_type = Column(String, nullable=True)
    property_type_priority = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
