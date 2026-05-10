from sqlalchemy import Column, String, Text, Boolean, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
from enum import Enum
import uuid

from database import Base


class TemplateType(str, Enum):
    GREETING = "greeting"
    FAREWELL = "farewell"
    PROPERTY_CARD = "property_card"
    CONTACT_REQUEST = "contact_request"
    CUSTOM = "custom"


class ChatTemplate(Base):
    __tablename__ = "chat_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    type = Column(String(50), nullable=False, default=TemplateType.CUSTOM)
    content = Column(Text, nullable=False)
    variables = Column(JSON, default=list)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
