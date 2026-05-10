from sqlalchemy import Column, String, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base


class ChatUser(Base):
    __tablename__ = "chat_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_number = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=True)
    profile = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    conversations = relationship(
        "ChatConversation",
        back_populates="user",
        order_by="ChatConversation.created_at.desc()",
    )
