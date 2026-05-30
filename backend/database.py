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
            id                                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            developer_id                         UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
            status                               recordstatus NOT NULL DEFAULT 'SUCCESS',
            scraped_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            nombre                               TEXT,
            estado_del_proyecto                  TEXT,
            ubicacion                            TEXT,
            precio_desde                         TEXT,
            imagen                               JSONB,
            descripcion                          TEXT,
            areas_comunes_exterior_e_interior_img JSONB,
            areas_comunes                        JSONB,
            areas_comunes_imagenes               JSONB,
            lugares_cercanos                     JSONB,
            extra_data                           JSONB NOT NULL DEFAULT '{}'
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_proyectos_developer ON proyectos (developer_id)"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS propiedades (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            proyecto_id  UUID REFERENCES proyectos(id) ON DELETE CASCADE,
            status       recordstatus NOT NULL DEFAULT 'SUCCESS',
            scraped_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            imagen_modelo TEXT,
            dormitorios  TEXT,
            m2           TEXT,
            modelo       TEXT,
            modelo_imagen TEXT,
            extra_data   JSONB NOT NULL DEFAULT '{}'
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_propiedades_proyecto ON propiedades (proyecto_id)"))


def _migrate_scraped_records_to_tables(conn):
    """One-time migration: copy scraped_records into proyectos and propiedades.
    Uses the same UUIDs so user_property_interactions references remain valid.
    """
    import json

    # Skip if already migrated
    count = conn.execute(text("SELECT COUNT(*) FROM proyectos")).scalar()
    if count > 0:
        return

    sr_exists = conn.execute(text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='scraped_records')"
    )).scalar()
    if not sr_exists:
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
        "nombre", "estado_del_proyecto", "ubicacion", "precio_desde", "imagen",
        "descripcion", "areas_comunes_exterior_e_interior_img",
        "areas_comunes", "areas_comunes_imagenes", "lugares_cercanos",
    }
    PROYECTO_ALIASES = {
        "proyecto": "nombre",
        "nombre del proyecto": "nombre",
        "estado del proyecto": "estado_del_proyecto",
        "ubicación": "ubicacion",
        "precio desde": "precio_desde",
    }
    PROPIEDAD_COLS = {
        "dormitorios", "m2", "modelo", "imagen_modelo", "modelo_imagen",
    }

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

    rows = conn.execute(text(
        "SELECT id, developer_id, url_node_id, source_url, data, status, scraped_at "
        "FROM scraped_records"
    )).fetchall()

    # In-memory map: (parent_node_id, url_propiedad_from_data) -> proyecto_id
    proj_map: dict = {}

    # --- Insert parent records into proyectos ---
    for rec_id, dev_id, node_id, source_url, data, status, scraped_at in rows:
        if str(node_id) not in parent_node_ids:
            continue
        kw, extra = map_data(data, PROYECTO_COLS, PROYECTO_ALIASES)
        status_val = status.value if hasattr(status, 'value') else str(status)
        url_prop = (data or {}).get("url_propiedad")
        if url_prop:
            proj_map[(str(node_id), url_prop)] = str(rec_id)
        conn.execute(text("""
            INSERT INTO proyectos (id, developer_id, status, scraped_at,
                nombre, estado_del_proyecto, ubicacion, precio_desde, imagen,
                descripcion, areas_comunes_exterior_e_interior_img, areas_comunes,
                areas_comunes_imagenes, lugares_cercanos, extra_data)
            VALUES (:id, :dev_id, CAST(:status AS recordstatus), :scraped_at,
                :nombre, :estado_del_proyecto, :ubicacion, :precio_desde, CAST(:imagen AS jsonb),
                :descripcion, CAST(:acei AS jsonb), CAST(:areas_comunes AS jsonb),
                CAST(:areas_comunes_imagenes AS jsonb), CAST(:lugares_cercanos AS jsonb),
                CAST(:extra_data AS jsonb))
            ON CONFLICT (id) DO NOTHING
        """), {
            "id": str(rec_id), "dev_id": str(dev_id),
            "status": status_val, "scraped_at": scraped_at,
            "nombre": kw.get("nombre"),
            "estado_del_proyecto": kw.get("estado_del_proyecto"),
            "ubicacion": kw.get("ubicacion"),
            "precio_desde": kw.get("precio_desde"),
            "imagen": jsonb_val(kw.get("imagen")),
            "descripcion": kw.get("descripcion"),
            "acei": jsonb_val(kw.get("areas_comunes_exterior_e_interior_img")),
            "areas_comunes": jsonb_val(kw.get("areas_comunes")),
            "areas_comunes_imagenes": jsonb_val(kw.get("areas_comunes_imagenes")),
            "lugares_cercanos": jsonb_val(kw.get("lugares_cercanos")),
            "extra_data": json.dumps(extra),
        })

    # --- Insert child records into propiedades ---
    for rec_id, dev_id, node_id, source_url, data, status, scraped_at in rows:
        if str(node_id) not in child_node_ids:
            continue
        kw, extra = map_data(data, PROPIEDAD_COLS, {})
        status_val = status.value if hasattr(status, 'value') else str(status)
        parent_nid = child_to_parent_node.get(str(node_id))
        proyecto_id = proj_map.get((parent_nid, source_url)) if parent_nid else None
        conn.execute(text("""
            INSERT INTO propiedades (id, proyecto_id, status, scraped_at,
                dormitorios, m2, modelo, imagen_modelo, modelo_imagen, extra_data)
            VALUES (:id, :proyecto_id, CAST(:status AS recordstatus), :scraped_at,
                :dormitorios, :m2, :modelo, :imagen_modelo, :modelo_imagen,
                CAST(:extra_data AS jsonb))
            ON CONFLICT (id) DO NOTHING
        """), {
            "id": str(rec_id), "proyecto_id": proyecto_id,
            "status": status_val, "scraped_at": scraped_at,
            "dormitorios": kw.get("dormitorios"),
            "m2": kw.get("m2"),
            "modelo": kw.get("modelo"),
            "imagen_modelo": kw.get("imagen_modelo"),
            "modelo_imagen": kw.get("modelo_imagen"),
            "extra_data": json.dumps(extra),
        })

    # Migrate user_property_interactions FK: scraped_records → propiedades
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


def _backup_extraction_templates(conn):
    """Create plantillas_extraccion as a Spanish-named backup of extraction_templates."""
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS plantillas_extraccion (
            id              UUID PRIMARY KEY,
            developer_id    UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
            nodos           JSONB NOT NULL DEFAULT '[]',
            actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    has_templates = conn.execute(text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='extraction_templates')"
    )).scalar()
    if has_templates:
        conn.execute(text("""
            INSERT INTO plantillas_extraccion (id, developer_id, nodos, actualizado_en)
            SELECT id, developer_id, nodes, updated_at
            FROM extraction_templates
            ON CONFLICT (id) DO UPDATE
                SET nodos = EXCLUDED.nodos,
                    actualizado_en = EXCLUDED.actualizado_en
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
        # ── Schema refactor: developers ──────────────────────────────────────────
        "ALTER TABLE developers ADD COLUMN IF NOT EXISTS proyectos_url TEXT",
        # ── Schema refactor: proyectos — add new columns ─────────────────────────
        "ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS nombre TEXT",
        "ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS descripcion TEXT",
        "ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS areas_comunes_exterior_e_interior_img JSONB",
        "ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS areas_comunes JSONB",
        "ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS areas_comunes_imagenes JSONB",
        "ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS lugares_cercanos JSONB",
        # ── Schema refactor: propiedades — add new columns ───────────────────────
        "ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS modelo_imagen TEXT",
        "ALTER TABLE propiedades ADD COLUMN IF NOT EXISTS baños TEXT",
        # NOTE: ALTER TYPE … ADD VALUE is handled separately with AUTOCOMMIT (see run_migrations)
        # ── user_property_interactions: add comment column ───────────────────────
        "ALTER TABLE user_property_interactions ADD COLUMN IF NOT EXISTS comment TEXT",
        # ── user_preferences: flat schema with priority columns ──────────────────
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS location_priority VARCHAR(20)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS bedrooms_priority VARCHAR(20)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS bathrooms INTEGER",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS bathrooms_priority VARCHAR(20)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS min_price_priority VARCHAR(20)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS max_price_priority VARCHAR(20)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS nearby_places JSONB",
        "ALTER TABLE user_preferences DROP COLUMN IF EXISTS nearby_places_priority",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS common_areas JSONB",
        "ALTER TABLE user_preferences DROP COLUMN IF EXISTS features",
        "ALTER TABLE user_preferences DROP COLUMN IF EXISTS features_priority",
        "ALTER TABLE user_preferences DROP COLUMN IF EXISTS location",
        "ALTER TABLE user_preferences DROP COLUMN IF EXISTS location_priority",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS direccion VARCHAR(255)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS direccion_priority VARCHAR(20)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(255)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS ubicacion_priority VARCHAR(20)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS pais VARCHAR(100)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS pais_priority VARCHAR(20)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS m2 FLOAT",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS m2_priority VARCHAR(20)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS property_type VARCHAR(100)",
        "ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS property_type_priority VARCHAR(20)",
        # ── user_documents table ─────────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS user_documents (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            site_user_id     UUID REFERENCES site_users(id) ON DELETE CASCADE,
            session_id       UUID REFERENCES web_chat_sessions(id) ON DELETE SET NULL,
            document_url     TEXT NOT NULL,
            document_kind    VARCHAR(50),
            original_filename TEXT,
            mime_type        VARCHAR(120),
            uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_user_documents_site_user ON user_documents (site_user_id)",
        "CREATE INDEX IF NOT EXISTS idx_user_documents_session ON user_documents (session_id)",
        # ── site_users: role column ──────────────────────────────────────────────
        "ALTER TABLE site_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'USER'",
        "ALTER TABLE site_users ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(50)",
        # ── admin_notifications table ────────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS admin_notifications (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            type           VARCHAR(50) NOT NULL,
            title          TEXT NOT NULL,
            body           TEXT,
            reference_id   UUID,
            reference_type VARCHAR(50),
            is_read        BOOLEAN NOT NULL DEFAULT FALSE,
            read_at        TIMESTAMPTZ,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        "CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON admin_notifications (type)",
        "CREATE INDEX IF NOT EXISTS idx_admin_notifications_is_read ON admin_notifications (is_read)",
    ]
    # Migrations that must run after data has been added (order matters)
    post_add_migrations = [
        # Migrate 'proyecto' text → 'nombre' (safe: skips if column already dropped)
        """DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='proyectos' AND column_name='proyecto') THEN UPDATE proyectos SET nombre = proyecto WHERE nombre IS NULL AND proyecto IS NOT NULL; END IF; END $$""",
        # Drop obsolete columns from proyectos
        "ALTER TABLE proyectos DROP COLUMN IF EXISTS url_node_id",
        "ALTER TABLE proyectos DROP COLUMN IF EXISTS source_url",
        "ALTER TABLE proyectos DROP COLUMN IF EXISTS url_propiedad",
        "ALTER TABLE proyectos DROP COLUMN IF EXISTS proyecto",
        "ALTER TABLE proyectos DROP COLUMN IF EXISTS dormitorios",
        "ALTER TABLE proyectos DROP COLUMN IF EXISTS m2",
        # Drop obsolete columns from propiedades (FK first)
        "ALTER TABLE propiedades DROP CONSTRAINT IF EXISTS propiedades_developer_id_fkey",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS developer_id",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS url_node_id",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS source_url",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS url_propiedad",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS estado_del_proyecto",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS ubicacion",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS lugares_cercanos",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS proyecto",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS areas_comunes_e_interior",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS areas_comunes",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS areas_comunes_imagenes",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS descripcion",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS precio_desde",
        "ALTER TABLE propiedades DROP COLUMN IF EXISTS imagen",
        # ── user_preferences: drop legacy columns and migrate PK to site_user_id ─
        "ALTER TABLE user_preferences DROP COLUMN IF EXISTS keywords",
        "ALTER TABLE user_preferences DROP COLUMN IF EXISTS raw_description",
        "ALTER TABLE user_preferences DROP COLUMN IF EXISTS preferences_v2",
        "ALTER TABLE user_preferences DROP COLUMN IF EXISTS context",
        """DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='user_preferences' AND column_name='id'
            ) THEN
                ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_pkey;
                ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS user_preferences_site_user_id_key;
                ALTER TABLE user_preferences DROP COLUMN IF EXISTS id;
                BEGIN
                    ALTER TABLE user_preferences ADD PRIMARY KEY (site_user_id);
                EXCEPTION WHEN others THEN NULL;
                END;
            END IF;
        END $$""",
    ]
    # ── ALTER TYPE must run outside any transaction (PostgreSQL limitation) ──────
    _ENUM_MIGRATIONS = [
        "ALTER TYPE recordstatus ADD VALUE IF NOT EXISTS 'pending_review'",
        "ALTER TYPE recordstatus ADD VALUE IF NOT EXISTS 'public'",
    ]
    try:
        raw = engine.raw_connection()
        raw.set_isolation_level(0)          # AUTOCOMMIT
        cur = raw.cursor()
        for stmt in _ENUM_MIGRATIONS:
            try:
                cur.execute(stmt)
            except Exception:
                pass
        cur.close()
        raw.close()
    except Exception:
        pass

    # ── Regular migrations — each committed individually so one failure ─────────
    # ── doesn't roll back the others. ─────────────────────────────────────────
    with engine.connect() as conn:
        has_fields = conn.execute(text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='fields')"
        )).scalar()
        if has_fields:
            for sql in legacy_migrations:
                try:
                    conn.execute(text(sql))
                    conn.commit()
                except Exception:
                    conn.rollback()
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                conn.rollback()
        _migrate_templates_to_json(conn)
        _create_standard_tables(conn)
        conn.commit()
        _migrate_scraped_records_to_tables(conn)
        conn.commit()
        for sql in post_add_migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                conn.rollback()
        _backup_extraction_templates(conn)
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
