from sqlalchemy import Column, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base
from app.models.scraped_record import RecordStatus


class Propiedad(Base):
    __tablename__ = "propiedades"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    developer_id = Column(UUID(as_uuid=True), ForeignKey("developers.id", ondelete="CASCADE"), nullable=False, index=True)
    proyecto_id  = Column(UUID(as_uuid=True), ForeignKey("proyectos.id", ondelete="CASCADE"), nullable=True, index=True)
    url_node_id  = Column(UUID(as_uuid=True), nullable=False, index=True)
    source_url   = Column(Text, nullable=False, default="")
    status       = Column(SQLEnum(RecordStatus, create_type=False), default=RecordStatus.SUCCESS)
    scraped_at   = Column(DateTime, default=datetime.utcnow, nullable=False)

    url_propiedad            = Column(Text, nullable=True)
    estado_del_proyecto      = Column(Text, nullable=True)
    ubicacion                = Column(Text, nullable=True)
    imagen_modelo            = Column(Text, nullable=True)
    lugares_cercanos         = Column(JSONB, nullable=True)
    proyecto                 = Column(Text, nullable=True)
    dormitorios              = Column(Text, nullable=True)
    m2                       = Column(Text, nullable=True)
    areas_comunes_e_interior = Column(JSONB, nullable=True)
    modelo                   = Column(Text, nullable=True)
    descripcion              = Column(Text, nullable=True)
    precio_desde             = Column(Text, nullable=True)
    areas_comunes            = Column(JSONB, nullable=True)
    areas_comunes_imagenes   = Column(JSONB, nullable=True)
    imagen                   = Column(JSONB, nullable=True)
    extra_data               = Column(JSONB, default=dict)

    developer    = relationship("Developer", back_populates="propiedades")
    proyecto_obj = relationship("Proyecto", back_populates="propiedades")

    def to_data(self) -> dict:
        d = {}
        for col in ("url_propiedad", "estado_del_proyecto", "ubicacion", "imagen_modelo",
                    "lugares_cercanos", "proyecto", "dormitorios", "m2",
                    "areas_comunes_e_interior", "modelo", "descripcion", "precio_desde",
                    "areas_comunes", "areas_comunes_imagenes", "imagen"):
            val = getattr(self, col)
            if val is not None:
                d[col] = val
        if self.extra_data:
            d.update(self.extra_data)
        return d
