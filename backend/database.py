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


def _create_standard_tables(conn):
    """Create proyectos and propiedades tables with standardized columns."""
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS proyectos (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            developer_id        UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
            url_node_id         UUID NOT NULL,
            source_url          TEXT NOT NULL DEFAULT '',
            status              recordstatus NOT NULL DEFAULT 'SUCCESS',
            scraped_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            url_propiedad       TEXT,
            estado_del_proyecto TEXT,
            proyecto            TEXT,
            dormitorios         TEXT,
            m2                  TEXT,
            ubicacion           TEXT,
            precio_desde        TEXT,
            imagen              JSONB,
            extra_data          JSONB NOT NULL DEFAULT '{}'
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_proyectos_developer ON proyectos (developer_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_proyectos_node ON proyectos (url_node_id)"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS propiedades (
            id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            developer_id             UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
            proyecto_id              UUID REFERENCES proyectos(id) ON DELETE CASCADE,
            url_node_id              UUID NOT NULL,
            source_url               TEXT NOT NULL DEFAULT '',
            status                   recordstatus NOT NULL DEFAULT 'SUCCESS',
            scraped_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            url_propiedad            TEXT,
            estado_del_proyecto      TEXT,
            ubicacion                TEXT,
            imagen_modelo            TEXT,
            lugares_cercanos         JSONB,
            proyecto                 TEXT,
            dormitorios              TEXT,
            m2                       TEXT,
            areas_comunes_e_interior JSONB,
            modelo                   TEXT,
            descripcion              TEXT,
            precio_desde             TEXT,
            areas_comunes            JSONB,
            areas_comunes_imagenes   JSONB,
            imagen                   JSONB,
            extra_data               JSONB NOT NULL DEFAULT '{}'
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_propiedades_developer ON propiedades (developer_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_propiedades_proyecto ON propiedades (proyecto_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_propiedades_node ON propiedades (url_node_id)"))


def _migrate_scraped_records_to_tables(conn):
    """One-time migration: copy scraped_records into proyectos and propiedades.
    Uses the same UUIDs so user_property_interactions references remain valid.
    """
    import json

    # Skip if already migrated
    count = conn.execute(text("SELECT COUNT(*) FROM proyectos")).scalar()
    if count > 0:
        return

    # Check scraped_records has data
    sr_count = conn.execute(text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='scraped_records')"
    )).scalar()
    if not sr_count:
        return
    sr_count = conn.execute(text("SELECT COUNT(*) FROM scraped_records")).scalar()
    if not sr_count:
        return

    # Build node type map from templates
    templates = conn.execute(text("SELECT nodes FROM extraction_templates")).fetchall()
    parent_node_ids: set = set()
    child_node_ids: set = set()
    child_to_parent_node: dict = {}
    for (nodes,) in templates:
        for node in (nodes or []):
            nid = node.get("id", "")
            pid = node.get("parent_id") or ""
            if pid:
                child_node_ids.add(nid)
                child_to_parent_node[nid] = pid
            else:
                parent_node_ids.add(nid)

    PROYECTO_COLS = {
        "url_propiedad", "estado_del_proyecto", "proyecto",
        "dormitorios", "m2", "ubicacion", "precio_desde", "imagen",
    }
    PROYECTO_ALIASES = {
        "estado del proyecto": "estado_del_proyecto",
        "ubicación": "ubicacion",
        "precio desde": "precio_desde",
    }
    PROPIEDAD_COLS = {
        "url_propiedad", "estado_del_proyecto", "ubicacion", "imagen_modelo",
        "lugares_cercanos", "proyecto", "dormitorios", "m2",
        "areas_comunes_e_interior", "modelo", "descripcion",
        "precio_desde", "areas_comunes", "areas_comunes_imagenes", "imagen",
    }
    PROPIEDAD_ALIASES = {
        "estado del proyecto": "estado_del_proyecto",
        "ubicación": "ubicacion",
        "lugares cercanos": "lugares_cercanos",
        "áreas comunes e interior": "areas_comunes_e_interior",
        "áreas comunes (imágenes)": "areas_comunes_imagenes",
        "descripción": "descripcion",
        "precio desde": "precio_desde",
        "áreas comunes": "areas_comunes",
    }

    JSONB_COLS = {"imagen", "lugares_cercanos", "areas_comunes_e_interior",
                  "areas_comunes", "areas_comunes_imagenes"}

    def map_data(data, cols, aliases):
        kwargs, extra = {}, {}
        for k, v in (data or {}).items():
            col = aliases.get(k, k)
            if col in cols:
                kwargs[col] = v
            else:
                extra[k] = v
        return kwargs, extra

    def jsonb_val(v):
        return json.dumps(v) if v is not None else None

    # Read all records
    rows = conn.execute(text(
        "SELECT id, developer_id, url_node_id, source_url, data, status, scraped_at "
        "FROM scraped_records"
    )).fetchall()

    # --- Insert parent records into proyectos ---
    for rec_id, dev_id, node_id, source_url, data, status, scraped_at in rows:
        if str(node_id) not in parent_node_ids:
            continue
        kw, extra = map_data(data, PROYECTO_COLS, PROYECTO_ALIASES)
        status_val = status.value if hasattr(status, 'value') else str(status)
        conn.execute(text("""
            INSERT INTO proyectos (id, developer_id, url_node_id, source_url, status, scraped_at,
                url_propiedad, estado_del_proyecto, proyecto, dormitorios, m2,
                ubicacion, precio_desde, imagen, extra_data)
            VALUES (:id, :dev_id, :node_id, :source_url, CAST(:status AS recordstatus), :scraped_at,
                :url_propiedad, :estado_del_proyecto, :proyecto, :dormitorios, :m2,
                :ubicacion, :precio_desde, CAST(:imagen AS jsonb), CAST(:extra_data AS jsonb))
            ON CONFLICT (id) DO NOTHING
        """), {
            "id": str(rec_id), "dev_id": str(dev_id), "node_id": str(node_id),
            "source_url": source_url or "", "status": status_val, "scraped_at": scraped_at,
            "url_propiedad": kw.get("url_propiedad"),
            "estado_del_proyecto": kw.get("estado_del_proyecto"),
            "proyecto": kw.get("proyecto"),
            "dormitorios": kw.get("dormitorios"),
            "m2": kw.get("m2"),
            "ubicacion": kw.get("ubicacion"),
            "precio_desde": kw.get("precio_desde"),
            "imagen": jsonb_val(kw.get("imagen")),
            "extra_data": json.dumps(extra),
        })

    # Build lookup: (parent_node_id, url_propiedad) -> proyecto.id
    proj_rows = conn.execute(text(
        "SELECT id, url_node_id, url_propiedad FROM proyectos"
    )).fetchall()
    proj_map: dict = {}
    for proj_id, proj_node_id, proj_url_prop in proj_rows:
        if proj_url_prop:
            proj_map[(str(proj_node_id), proj_url_prop)] = str(proj_id)

    # --- Insert child records into propiedades ---
    for rec_id, dev_id, node_id, source_url, data, status, scraped_at in rows:
        if str(node_id) not in child_node_ids:
            continue
        kw, extra = map_data(data, PROPIEDAD_COLS, PROPIEDAD_ALIASES)
        status_val = status.value if hasattr(status, 'value') else str(status)
        parent_nid = child_to_parent_node.get(str(node_id))
        proyecto_id = proj_map.get((parent_nid, source_url)) if parent_nid else None
        conn.execute(text("""
            INSERT INTO propiedades (id, developer_id, proyecto_id, url_node_id, source_url,
                status, scraped_at, url_propiedad, estado_del_proyecto, ubicacion,
                imagen_modelo, lugares_cercanos, proyecto, dormitorios, m2,
                areas_comunes_e_interior, modelo, descripcion, precio_desde,
                areas_comunes, areas_comunes_imagenes, imagen, extra_data)
            VALUES (:id, :dev_id, :proyecto_id, :node_id, :source_url,
                CAST(:status AS recordstatus), :scraped_at, :url_propiedad, :estado_del_proyecto, :ubicacion,
                :imagen_modelo, CAST(:lugares_cercanos AS jsonb), :proyecto, :dormitorios, :m2,
                CAST(:areas_comunes_e_interior AS jsonb), :modelo, :descripcion, :precio_desde,
                CAST(:areas_comunes AS jsonb), CAST(:areas_comunes_imagenes AS jsonb),
                CAST(:imagen AS jsonb), CAST(:extra_data AS jsonb))
            ON CONFLICT (id) DO NOTHING
        """), {
            "id": str(rec_id), "dev_id": str(dev_id), "proyecto_id": proyecto_id,
            "node_id": str(node_id), "source_url": source_url or "",
            "status": status_val, "scraped_at": scraped_at,
            "url_propiedad": kw.get("url_propiedad"),
            "estado_del_proyecto": kw.get("estado_del_proyecto"),
            "ubicacion": kw.get("ubicacion"),
            "imagen_modelo": kw.get("imagen_modelo"),
            "lugares_cercanos": jsonb_val(kw.get("lugares_cercanos")),
            "proyecto": kw.get("proyecto"),
            "dormitorios": kw.get("dormitorios"),
            "m2": kw.get("m2"),
            "areas_comunes_e_interior": jsonb_val(kw.get("areas_comunes_e_interior")),
            "modelo": kw.get("modelo"),
            "descripcion": kw.get("descripcion"),
            "precio_desde": kw.get("precio_desde"),
            "areas_comunes": jsonb_val(kw.get("areas_comunes")),
            "areas_comunes_imagenes": jsonb_val(kw.get("areas_comunes_imagenes")),
            "imagen": jsonb_val(kw.get("imagen")),
            "extra_data": json.dumps(extra),
        })

    # Migrate user_property_interactions FK: scraped_records → propiedades
    # Delete interactions pointing to records not in propiedades (e.g. parent records)
    conn.execute(text("""
        DELETE FROM user_property_interactions
        WHERE record_id NOT IN (SELECT id FROM propiedades)
    """))
    conn.execute(text("""
        ALTER TABLE user_property_interactions
        DROP CONSTRAINT IF EXISTS user_property_interactions_record_id_fkey
    """))
    conn.execute(text("""
        ALTER TABLE user_property_interactions
        ADD CONSTRAINT user_property_interactions_record_id_fkey
        FOREIGN KEY (record_id) REFERENCES propiedades(id) ON DELETE CASCADE
    """))


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
        _create_standard_tables(conn)
        conn.commit()
        _migrate_scraped_records_to_tables(conn)
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
