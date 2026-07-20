import uuid
from sqlalchemy import Column, String, Boolean, Integer, JSON, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base

DEFAULT_SITE_CONFIG_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")

DEFAULT_CARD_FIELDS = [
    {"key": "name", "label": "Proyecto", "type": "title"},
    {"key": "price", "label": "Precio", "type": "price"},
    {"key": "location", "label": "Ubicación", "type": "text"},
    {"key": "bedrooms", "label": "Dormitorios", "type": "badge"},
    {"key": "image_url", "label": "Imagen", "type": "image"},
]


class SiteConfig(Base):
    __tablename__ = "site_config"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # General
    site_name = Column(String, default="Mi Portal Inmobiliario")
    tagline = Column(String, nullable=True)
    primary_color = Column(String, default="#2563eb")
    secondary_color = Column(String, default="#059669")
    logo_text = Column(String, nullable=True)

    # Hero section
    show_hero = Column(Boolean, default=True)
    hero_title = Column(String, default="Encuentra tu propiedad ideal")
    hero_subtitle = Column(String, nullable=True, default="Explora los mejores proyectos disponibles")
    hero_cta_text = Column(String, default="Explorar propiedades")
    hero_bg_color = Column(String, default="#1e3a5f")

    # Carousel section
    show_carousel = Column(Boolean, default=True)
    carousel_title = Column(String, default="Proyectos destacados")
    carousel_field_image = Column(String, default="image_url")

    # Listing section
    show_listing = Column(Boolean, default=True)
    listing_title = Column(String, default="Propiedades disponibles")
    listing_columns = Column(String, default="3")  # "2" | "3" | "4"

    # Footer
    footer_text = Column(String, nullable=True, default="© 2025 Portal Inmobiliario")
    footer_contact = Column(String, nullable=True)

    # Card field mapping: [{key, label, type}]
    # types: title | price | text | badge | image | link
    card_fields = Column(JSON, default=lambda: list(DEFAULT_CARD_FIELDS))

    # Chatbot widget
    chatbot_enabled = Column(Boolean, default=True)
    chatbot_greeting = Column(String, default="¡Hola! Soy tu asistente inmobiliario. ¿Cuál es tu nombre?")
    chatbot_button_label = Column(String, default="¿Necesitas ayuda?")

    # Hero carousel: list of scraped record UUID strings handpicked by admin
    hero_record_ids = Column(JSON, nullable=True)

    # Featured section (Section 1)
    featured_enabled = Column(Boolean, default=True)
    featured_title = Column(String, default="Proyectos destacados")
    featured_level = Column(Integer, default=2)   # 1=root nodes, 2=child nodes
    featured_limit = Column(Integer, default=6)
    featured_field_keys = Column(JSON, nullable=True)  # [] = auto-detect all

    # Catalog section (Section 2)
    catalog_enabled = Column(Boolean, default=True)
    catalog_title = Column(String, default="Propiedades disponibles")
    catalog_level = Column(Integer, default=2)
    catalog_columns = Column(String, default="3")  # "2" | "3" | "4"
    catalog_field_keys = Column(JSON, nullable=True)  # [] = auto-detect all

    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
