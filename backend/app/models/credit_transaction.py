import uuid
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base


class CreditTransaction(Base):
    """
    Immutable credit ledger entry.
    Every balance change (purchase, deduction, refund, admin grant) produces one row.
    balance_after is denormalized for fast history display without re-summing.
    """
    __tablename__ = "credit_transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    advisor_id = Column(UUID(as_uuid=True), ForeignKey("sales_advisors.id", ondelete="CASCADE"), nullable=False, index=True)
    # purchase / deduction / refund / admin_grant
    type = Column(String(20), nullable=False)
    # positive = credits added, negative = credits spent
    amount = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    description = Column(Text, nullable=True)
    # Optional FK links for traceability
    package_id = Column(UUID(as_uuid=True), ForeignKey("credit_packages.id", ondelete="SET NULL"), nullable=True)
    lead_user_id = Column(UUID(as_uuid=True), ForeignKey("site_users.id", ondelete="SET NULL"), nullable=True)
    payment_id = Column(UUID(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
