from sqlalchemy import Column, Integer, DateTime, Numeric, String
from sqlalchemy.sql import func
from database import Base


class ScoringConfig(Base):
    __tablename__ = "scoring_config"

    id = Column(Integer, primary_key=True, default=1)

    # Max points per category
    perfil_max = Column(Integer, default=15, nullable=False)
    presupuesto_max = Column(Integer, default=10, nullable=False)
    preferencias_max = Column(Integer, default=10, nullable=False)
    actividad_max = Column(Integer, default=20, nullable=False)
    interes_max = Column(Integer, default=15, nullable=False)
    doc_subido_max = Column(Integer, default=10, nullable=False)
    doc_validado_max = Column(Integer, default=20, nullable=False)

    # Tier thresholds (minimum score to reach that tier)
    tier_muy_caliente_min = Column(Integer, default=76, nullable=False)
    tier_caliente_min = Column(Integer, default=56, nullable=False)
    tier_tibio_min = Column(Integer, default=31, nullable=False)

    # Lead pricing per tier
    price_muy_caliente = Column(Numeric(10, 2), default=0, nullable=True)
    price_caliente = Column(Numeric(10, 2), default=0, nullable=True)
    price_tibio = Column(Numeric(10, 2), default=0, nullable=True)
    price_frio = Column(Numeric(10, 2), default=0, nullable=True)
    price_currency = Column(String(10), default='PEN', nullable=False)

    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
