from sqlalchemy import Column, Integer, Numeric, String, DateTime
from sqlalchemy.sql import func
from database import Base


class CreditSettings(Base):
    __tablename__ = "credit_settings"

    id = Column(Integer, primary_key=True, default=1)
    base_price = Column(Numeric(10, 2), nullable=False, default=0.50)
    currency = Column(String(10), nullable=False, default="USD")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
