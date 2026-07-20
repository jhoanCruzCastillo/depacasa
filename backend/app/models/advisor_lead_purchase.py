from sqlalchemy import Column, DateTime, Numeric, String, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from database import Base


class AdvisorLeadPurchase(Base):
    __tablename__ = "advisor_lead_purchases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    advisor_id = Column(UUID(as_uuid=True), ForeignKey("sales_advisors.id", ondelete="CASCADE"), nullable=False, index=True)
    site_user_id = Column(UUID(as_uuid=True), ForeignKey("site_users.id", ondelete="CASCADE"), nullable=False, index=True)
    price_paid = Column(Numeric(10, 2), default=0, nullable=False)
    currency = Column(String(10), default="PEN", nullable=False)
    purchased_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("advisor_id", "site_user_id", name="uq_advisor_lead_purchase"),
    )
