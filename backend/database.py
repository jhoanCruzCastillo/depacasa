from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from contextlib import contextmanager
from config import settings

engine = create_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def run_migrations():
    """Add new columns to existing tables without dropping data."""
    migrations = [
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS plain_text BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE url_nodes ADD COLUMN IF NOT EXISTS container_selector VARCHAR(1000)",
        # Drop old direct_text column if still present (safe: IF EXISTS)
        "ALTER TABLE fields DROP COLUMN IF EXISTS direct_text",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS extract_attr VARCHAR(100)",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS is_list BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS list_container VARCHAR(1000)",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS is_image BOOLEAN NOT NULL DEFAULT FALSE",
        # Chat indexes for performance
        "CREATE INDEX IF NOT EXISTS idx_chat_users_phone ON chat_users (phone_number)",
        "CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON chat_conversations (user_id)",
        "CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages (conversation_id)",
        # Web chat session auth columns
        "ALTER TABLE web_chat_sessions ADD COLUMN IF NOT EXISTS email VARCHAR",
        "ALTER TABLE web_chat_sessions ADD COLUMN IF NOT EXISTS site_user_id UUID REFERENCES site_users(id)",
        # Portal config — hero carousel + featured + catalog sections
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS hero_record_ids JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS featured_enabled BOOLEAN DEFAULT TRUE",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS featured_title VARCHAR DEFAULT 'Proyectos destacados'",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS featured_level INTEGER DEFAULT 2",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS featured_limit INTEGER DEFAULT 6",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS featured_field_keys JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS catalog_enabled BOOLEAN DEFAULT TRUE",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS catalog_title VARCHAR DEFAULT 'Propiedades disponibles'",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS catalog_level INTEGER DEFAULT 2",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS catalog_columns VARCHAR DEFAULT '3'",
        "ALTER TABLE site_config ADD COLUMN IF NOT EXISTS catalog_field_keys JSONB DEFAULT '[]'::jsonb",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            conn.execute(text(sql))
        conn.commit()


def get_db():
    """Database session dependency for FastAPI"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_context():
    """Context manager for database sessions"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
