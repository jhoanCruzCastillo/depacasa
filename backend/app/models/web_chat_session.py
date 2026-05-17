import uuid
from sqlalchemy import Column, String, Integer, Text, JSON, DateTime, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base


class WebChatSession(Base):
    __tablename__ = "web_chat_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, nullable=True)
    site_user_id = Column(UUID(as_uuid=True), ForeignKey("site_users.id"), nullable=True)
    name = Column(String, nullable=True)
    country = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    # collecting_info | presenting | contact_requested
    state = Column(String, default="collecting_info")
    # 0=email, 1=name, 2=country, 3=phone, 4=description, 5+=done
    info_step = Column(Integer, default=0)
    ideal_description = Column(Text, nullable=True)
    extracted_criteria = Column(JSON, default=dict)
    matched_record_ids = Column(JSON, default=list)
    current_match_index = Column(Integer, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    inactivated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    messages = relationship(
        "WebChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="WebChatMessage.created_at",
    )


class WebChatMessage(Base):
    __tablename__ = "web_chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(
        UUID(as_uuid=True), ForeignKey("web_chat_sessions.id"), nullable=False, index=True
    )
    role = Column(String, nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("WebChatSession", back_populates="messages")
