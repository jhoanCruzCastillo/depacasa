from sqlalchemy import Column, String, Text, Integer, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum
import uuid

from database import Base


class ConversationState(str, Enum):
    GREETING = "greeting"
    PRESENTING = "presenting"
    CONTACT_REQUESTED = "contact_requested"


class ChatConversation(Base):
    __tablename__ = "chat_conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("chat_users.id"), nullable=False, index=True)
    state = Column(String(50), default=ConversationState.GREETING)
    ideal_description = Column(Text, nullable=True)
    extracted_criteria = Column(JSON, default=dict)
    matched_record_ids = Column(JSON, default=list)
    current_match_index = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("ChatUser", back_populates="conversations")
    messages = relationship(
        "ChatMessage",
        back_populates="conversation",
        order_by="ChatMessage.created_at",
    )
