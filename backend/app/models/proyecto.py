from sqlalchemy import Column, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base
from app.models.scraped_record import RecordStatus


class Proyecto(Base):
    __tablename__ = "proyectos"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    developer_id = Column(UUID(as_uuid=True), ForeignKey("developers.id", ondelete="CASCADE"), nullable=False, index=True)
    status       = Column(SQLEnum(RecordStatus, create_type=False), default=RecordStatus.SUCCESS)
    scraped_at   = Column(DateTime, default=datetime.utcnow, nullable=False)

    nombre                               = Column(Text, nullable=True)
    estado_del_proyecto                  = Column(Text, nullable=True)
    ubicacion                            = Column(Text, nullable=True)
    precio_desde                         = Column(Text, nullable=True)
    imagen                               = Column(JSONB, nullable=True)
    descripcion                          = Column(Text, nullable=True)
    areas_comunes_exterior_e_interior_img = Column(JSONB, nullable=True)
    areas_comunes                        = Column(JSONB, nullable=True)
    areas_comunes_imagenes               = Column(JSONB, nullable=True)
    lugares_cercanos                     = Column(JSONB, nullable=True)
    gmaps_url                            = Column(Text, nullable=True)
    gmaps_coordinates                    = Column(Text, nullable=True)
    extra_data                           = Column(JSONB, default=dict)

    developer   = relationship("Developer", back_populates="proyectos")
    propiedades = relationship("Propiedad", back_populates="proyecto_obj", cascade="all, delete-orphan")

    def to_data(self) -> dict:
        d = {}
        for col in ("nombre", "estado_del_proyecto", "ubicacion", "precio_desde", "imagen",
                    "descripcion", "areas_comunes_exterior_e_interior_img",
                    "areas_comunes", "areas_comunes_imagenes", "lugares_cercanos",
                    "gmaps_url", "gmaps_coordinates"):
            val = getattr(self, col)
            if val is not None:
                d[col] = val
        if self.extra_data:
            d.update(self.extra_data)
        return d
