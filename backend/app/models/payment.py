import uuid
from sqlalchemy import Column, String, Integer, Numeric, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from database import Base


class Payment(Base):
    """
    Provider-agnostic payment record.
    Supports Stripe, Culqi, or any future gateway via provider + provider_payment_id.
    """
    __tablename__ = "payments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    advisor_id = Column(UUID(as_uuid=True), ForeignKey("sales_advisors.id", ondelete="SET NULL"), nullable=True, index=True)
    package_id = Column(UUID(as_uuid=True), ForeignKey("credit_packages.id", ondelete="SET NULL"), nullable=True)
    amount_paid = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(10), nullable=False)
    credits_granted = Column(Integer, nullable=False)
    # pending / completed / failed / refunded
    status = Column(String(20), nullable=False, default="pending")
    # admin / stripe / culqi
    provider = Column(String(50), nullable=False, default="admin")
    provider_payment_id = Column(String(200), nullable=True, index=True)
    provider_metadata = Column(JSONB, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
