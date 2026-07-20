from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import uuid

from database import Base


class SalesAdvisor(Base):
    __tablename__ = "sales_advisors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    phone = Column(String(50), nullable=True)
    email = Column(String(200), nullable=True)
    whatsapp_number = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True)
    password_hash = Column(Text, nullable=True)

    # Profile fields
    developer_id = Column(UUID(as_uuid=True), ForeignKey("developers.id", ondelete="SET NULL"), nullable=True)
    bio = Column(Text, nullable=True)
    specialty = Column(String(200), nullable=True)

    # Credits
    credit_balance = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
