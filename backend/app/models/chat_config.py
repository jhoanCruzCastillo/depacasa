from sqlalchemy import Column, Integer, DateTime, Text, String
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import uuid

from database import Base

DEFAULT_CONFIG_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

_DEFAULT_GREETING = (
    "Hola! Soy tu asistente inmobiliario personal.\n\n"
    "Estoy aqui para ayudarte a encontrar la propiedad ideal.\n\n"
    "Cuentame, como describes tu propiedad ideal? Puedes mencionar:\n"
    "- Ubicacion (distrito, ciudad)\n"
    "- Tipo (departamento, casa, oficina...)\n"
    "- Numero de habitaciones\n"
    "- Presupuesto aproximado\n"
    "- Caracteristicas importantes para ti"
)

_DEFAULT_CONTACT = (
    "Excelente eleccion! Un asesor de ventas se comunicara contigo muy pronto "
    "con todos los detalles de esta propiedad. Gracias por tu interes!"
)

_DEFAULT_NO_RESULTS = (
    "No encontre propiedades que coincidan con tu busqueda en este momento. "
    "Podrias describir con mas detalle o flexibilizar algun criterio?"
)

_DEFAULT_NO_MORE = (
    "Ya has visto todas las propiedades disponibles que coinciden con tu busqueda.\n\n"
    "Si deseas, puedes actualizar tu descripcion para explorar otras opciones."
)


class ChatConfig(Base):
    __tablename__ = "chat_config"

    id = Column(UUID(as_uuid=True), primary_key=True, default=lambda: DEFAULT_CONFIG_ID)
    top_n_properties = Column(Integer, default=3)
    greeting_message = Column(Text, default=_DEFAULT_GREETING)
    contact_message = Column(Text, default=_DEFAULT_CONTACT)
    no_results_message = Column(Text, default=_DEFAULT_NO_RESULTS)
    no_more_message = Column(Text, default=_DEFAULT_NO_MORE)
    ai_model = Column(String(100), default="claude-sonnet-4-6", nullable=False, server_default="claude-sonnet-4-6")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
