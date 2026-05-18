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


def _migrate_templates_to_json(conn):
    """One-time migration: copy url_nodes/fields/selectors into extraction_templates JSONB.
    Safe to run on installs where those old tables don't exist (skips silently).
    """
    import json, uuid as _uuid

    # Check if old tables still exist
    res = conn.execute(text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='url_nodes')"
    ))
    if not res.scalar():
        return  # fresh install — nothing to migrate

    # Create new table if needed
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS extraction_templates (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            developer_id UUID UNIQUE NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
            nodes        JSONB NOT NULL DEFAULT '[]',
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    # Read all nodes
    nodes_rows = conn.execute(text(
        "SELECT id, developer_id, parent_id, name, url, container_selector, \"order\" FROM url_nodes"
    )).fetchall()

    # Read all fields
    fields_rows = conn.execute(text(
        "SELECT id, url_node_id, name, is_child_url, plain_text, is_shared, is_list, "
        "list_container, is_image, extract_attr, \"order\" FROM fields"
    )).fetchall()

    # Read all selectors
    sel_rows = conn.execute(text(
        "SELECT field_id, value, \"order\" FROM selectors"
    )).fetchall()

    # Build lookup maps
    selectors_by_field: dict = {}
    for s in sel_rows:
        selectors_by_field.setdefault(str(s.field_id), []).append(
            {"value": s.value, "order": s.order}
        )

    fields_by_node: dict = {}
    for f in fields_rows:
        fields_by_node.setdefault(str(f.url_node_id), []).append({
            "id":             str(f.id),
            "name":           f.name,
            "is_child_url":   f.is_child_url,
            "plain_text":     f.plain_text,
            "is_shared":      f.is_shared,
            "is_list":        f.is_list,
            "list_container": f.list_container,
            "is_image":       f.is_image,
            "extract_attr":   f.extract_attr,
            "order":          f.order,
            "selectors":      sorted(selectors_by_field.get(str(f.id), []), key=lambda x: x["order"]),
            "inherited_from": None,
        })

    nodes_by_dev: dict = {}
    for n in nodes_rows:
        nodes_by_dev.setdefault(str(n.developer_id), []).append({
            "id":                 str(n.id),
            "parent_id":          str(n.parent_id) if n.parent_id else None,
            "name":               n.name,
            "url":                n.url,
            "container_selector": n.container_selector,
            "order":              n.order,
            "fields":             sorted(fields_by_node.get(str(n.id), []), key=lambda x: x["order"]),
        })

    # Insert into extraction_templates (skip if already migrated)
    for dev_id, nodes in nodes_by_dev.items():
        conn.execute(text("""
            INSERT INTO extraction_templates (id, developer_id, nodes, updated_at)
            VALUES (:id, :dev_id, CAST(:nodes AS jsonb), NOW())
            ON CONFLICT (developer_id) DO NOTHING
        """), {"id": str(_uuid.uuid4()), "dev_id": dev_id, "nodes": json.dumps(nodes)})

    # Drop FK constraint on scraped_records.url_node_id (ignore if already dropped)
    conn.execute(text(
        "ALTER TABLE scraped_records DROP CONSTRAINT IF EXISTS scraped_records_url_node_id_fkey"
    ))

    # Drop old tables
    conn.execute(text("DROP TABLE IF EXISTS selectors CASCADE"))
    conn.execute(text("DROP TABLE IF EXISTS fields    CASCADE"))
    conn.execute(text("DROP TABLE IF EXISTS url_nodes CASCADE"))


def run_migrations():
    """Add new columns to existing tables without dropping data."""
    # Legacy migrations only run if the old url_nodes/fields tables still exist.
    legacy_migrations = [
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS plain_text BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE url_nodes ADD COLUMN IF NOT EXISTS container_selector VARCHAR(1000)",
        "ALTER TABLE fields DROP COLUMN IF EXISTS direct_text",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS extract_attr VARCHAR(100)",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS is_list BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS list_container VARCHAR(1000)",
        "ALTER TABLE fields ADD COLUMN IF NOT EXISTS is_image BOOLEAN NOT NULL DEFAULT FALSE",
    ]
    migrations = [
        # Chat indexes for performance
        "CREATE INDEX IF NOT EXISTS idx_chat_users_phone ON chat_users (phone_number)",
        "CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON chat_conversations (user_id)",
        "CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages (conversation_id)",
        # Web chat session auth columns
        "ALTER TABLE web_chat_sessions ADD COLUMN IF NOT EXISTS email VARCHAR",
        "ALTER TABLE web_chat_sessions ADD COLUMN IF NOT EXISTS site_user_id UUID REFERENCES site_users(id)",
        "ALTER TABLE web_chat_sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE web_chat_sessions ADD COLUMN IF NOT EXISTS inactivated_at TIMESTAMPTZ",
        "CREATE INDEX IF NOT EXISTS idx_web_chat_sessions_user_active ON web_chat_sessions (site_user_id, is_active)",
        # User preference V2 model
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preferences_v2 JSONB",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS context JSONB",
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
        # Lead scoring: manual document validation fields
        "ALTER TABLE site_users ADD COLUMN IF NOT EXISTS financial_doc_status VARCHAR(20)",
        "ALTER TABLE site_users ADD COLUMN IF NOT EXISTS financial_doc_notes TEXT",
        "ALTER TABLE site_users ADD COLUMN IF NOT EXISTS financial_doc_reviewed_at TIMESTAMPTZ",
        "ALTER TABLE site_users ADD COLUMN IF NOT EXISTS financial_doc_reviewed_by VARCHAR(200)",
    ]
    with engine.connect() as conn:
        has_fields = conn.execute(text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='fields')"
        )).scalar()
        if has_fields:
            for sql in legacy_migrations:
                conn.execute(text(sql))
        for sql in migrations:
            conn.execute(text(sql))
        _migrate_templates_to_json(conn)
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
