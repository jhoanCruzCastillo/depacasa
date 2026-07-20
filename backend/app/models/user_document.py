import uuid
from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base


class UserDocument(Base):
    """A file uploaded by a site user (or associated to a chat session)."""
    __tablename__ = "user_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_user_id = Column(UUID(as_uuid=True), ForeignKey("site_users.id", ondelete="CASCADE"),
                          nullable=True, index=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("web_chat_sessions.id", ondelete="SET NULL"),
                        nullable=True, index=True)

    document_url = Column(Text, nullable=False)
    document_kind = Column(String(50), nullable=True)   # e.g. "financial_capacity", "identity", "other"
    original_filename = Column(Text, nullable=True)
    mime_type = Column(String(120), nullable=True)

    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
