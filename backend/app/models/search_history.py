import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base


class SearchHistory(Base):
    __tablename__ = "search_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("site_users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    query = Column(String, nullable=True)
    location = Column(String, nullable=True)
    project_id = Column(String, nullable=True)
    source = Column(String, nullable=False, default="portal")  # 'portal' | 'chatbot'
    created_at = Column(DateTime(timezone=True), server_default=func.now())
