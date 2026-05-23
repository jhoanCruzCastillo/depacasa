from sqlalchemy import Column, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base
from app.models.scraped_record import RecordStatus


class Propiedad(Base):
    __tablename__ = "propiedades"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    proyecto_id = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True, index=True)
    status      = Column(SQLEnum(RecordStatus, create_type=False), default=RecordStatus.SUCCESS)
    scraped_at  = Column(DateTime, default=datetime.utcnow, nullable=False)

    imagen_modelo = Column(Text, nullable=True)
    dormitorios   = Column(Text, nullable=True)
    m2            = Column(Text, nullable=True)
    modelo        = Column(Text, nullable=True)
    modelo_imagen = Column(Text, nullable=True)
    extra_data    = Column(JSONB, default=dict)

    proyecto_obj = relationship("Proyecto", back_populates="propiedades")

    def to_data(self) -> dict:
        d = {}
        for col in ("imagen_modelo", "dormitorios", "m2", "modelo", "modelo_imagen"):
            val = getattr(self, col)
            if val is not None:
                d[col] = val
        if self.extra_data:
            d.update(self.extra_data)
        return d
