import uuid
from sqlalchemy import Column, Boolean, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base


class UserPropertyInteraction(Base):
    """Tracks every touchpoint between a registered user and a scraped property."""
    __tablename__ = "user_property_interactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_user_id = Column(UUID(as_uuid=True), ForeignKey("site_users.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    record_id = Column(UUID(as_uuid=True), ForeignKey("scraped_records.id", ondelete="CASCADE"),
                       nullable=False, index=True)

    seen_in_chat = Column(Boolean, default=False)
    rating = Column(Integer, nullable=True)      # 1-5 stars, null = not rated
    interested = Column(Boolean, default=False)  # clicked "Lo quiero"
    sent_by_email = Column(Boolean, default=False)

    seen_at = Column(DateTime(timezone=True), nullable=True)
    rated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("site_user_id", "record_id", name="uq_user_property_interaction"),
    )
