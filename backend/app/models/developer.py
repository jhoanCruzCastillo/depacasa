from sqlalchemy import Column, String, DateTime, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum
import uuid

from database import Base


class DeveloperSource(str, Enum):
    TAVILY = "tavily"
    MANUAL = "manual"


class Developer(Base):
    __tablename__ = "developers"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name          = Column(String(255), unique=True, nullable=False, index=True)
    description   = Column(String(1000), nullable=True)
    base_url      = Column(String(2000), nullable=False, unique=True)
    logo_url      = Column(String(2000), nullable=True)
    proyectos_url = Column(String(2000), nullable=True)
    source        = Column(SQLEnum(DeveloperSource), default=DeveloperSource.MANUAL)
    created_at    = Column(DateTime, default=datetime.utcnow, nullable=False)

    extraction_template = relationship("ExtractionTemplate", back_populates="developer", uselist=False, cascade="all, delete-orphan")
    scraped_records     = relationship("ScrapedRecord", back_populates="developer", cascade="all, delete-orphan")
    proyectos           = relationship("Proyecto", back_populates="developer", cascade="all, delete-orphan")
    scrape_jobs         = relationship("ScrapeJob", back_populates="developer", cascade="all, delete-orphan")
