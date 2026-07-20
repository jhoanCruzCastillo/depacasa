"""Celery tasks for background scraping"""

import logging
import asyncio
import sys
import hashlib
from pathlib import Path

# Ensure the backend root (/app) is in sys.path for Celery workers
if '/app' not in sys.path:
    sys.path.insert(0, '/app')

# ── Browser config — must match visual_selector_service.py exactly so that
#    the same CSS selectors work (both render the same HTML from the server). ──
_SCRAPER_LAUNCH_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
]
_SCRAPER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_SCRAPER_STEALTH = (
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});"
    "if(!window.chrome)window.chrome={};"
    "if(!window.chrome.runtime)window.chrome.runtime={};"
    "Object.defineProperty(navigator,'languages',{get:()=>['es-ES','es','en-US','en']});"
)

from celery import Celery
from config import settings

logger = logging.getLogger(__name__)

MEDIA_DIR = Path("/app/media/images")
_VALID_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "gif", "avif", "svg"}

# ── Field name → column name mappings ────────────────────────────────────────

_PROYECTO_COLS = {
    # url_propiedad is NOT stored — it's only used for child-page navigation
    "nombre",
    "estado_del_proyecto",
    "ubicacion",
    "precio_desde",
    "imagen",
    "descripcion",
    "areas_comunes_exterior_e_interior_img",
    "areas_comunes",
    "areas_comunes_imagenes",
    "lugares_cercanos",
    "gmaps_url",
    "gmaps_coordinates",
}
_PROYECTO_ALIASES = {
    "nombre del proyecto": "nombre",
    "proyecto":            "nombre",   # backwards compat with old templates
    "estado del proyecto": "estado_del_proyecto",
    "ubicación":           "ubicacion",
    "precio desde":        "precio_desde",
    "descripción":         "descripcion",
    "lugares cercanos":    "lugares_cercanos",
    "áreas comunes":       "areas_comunes",
    "áreas comunes (imágenes)": "areas_comunes_imagenes",
    "áreas comunes e interior": "areas_comunes_exterior_e_interior_img",
}

_PROPIEDAD_COLS = {
    "imagen_modelo",
    "dormitorios",
    "m2",
    "modelo",
    "modelo_imagen",
}
_PROPIEDAD_ALIASES = {
    "imagen del modelo":      "imagen_modelo",
    "metros cuadrados":       "m2",
    "metros cuadrados (m²)":  "m2",
}


_PROJECT_LEVEL_FIELDS = (
    _PROYECTO_COLS
    | set(_PROYECTO_ALIASES.keys())
    | {"url_propiedad", "url_proyecto"}
)


def _map_data_to_columns(data: dict, is_child: bool) -> tuple[dict, dict]:
    """Split scraped data dict into (column_kwargs, extra_data)."""
    cols    = _PROPIEDAD_COLS    if is_child else _PROYECTO_COLS
    aliases = _PROPIEDAD_ALIASES if is_child else _PROYECTO_ALIASES
    kwargs: dict = {}
    extra:  dict = {}
    for key, val in data.items():
        col = aliases.get(key, key)
        if col in cols:
            kwargs[col] = val
        elif is_child and (key in _PROJECT_LEVEL_FIELDS or col in _PROJECT_LEVEL_FIELDS):
            pass  # drop project-level fields from propiedad records
        else:
            extra[key] = val
    return kwargs, extra


def _update_proyecto_shared(db, proyecto_id, shared_data: dict) -> None:
    """Update a Proyecto record with shared fields extracted from its detail page."""
    if not proyecto_id or not shared_data:
        return
    from app.models.proyecto import Proyecto
    from uuid import UUID
    proj = db.query(Proyecto).filter(Proyecto.id == proyecto_id).first()
    if not proj:
        return
    col_kwargs, _ = _map_data_to_columns(shared_data, is_child=False)
    for col, val in col_kwargs.items():
        # Child shared fields come from the project detail page (more specific than
        # the listing page), so they always overwrite whatever the root node scraped.
        if val is not None and val != '':
            setattr(proj, col, val)
    db.flush()


async def _resolve_gmaps_coordinates(short_url: str) -> str | None:
    """Follow a maps.app.goo.gl (or any Google Maps) short URL and extract 'lat,lng'."""
    import httpx, re
    if not short_url or "google.com/maps" not in short_url and "goo.gl" not in short_url and "maps.app" not in short_url:
        return None
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            r = await client.get(short_url)
            final_url = str(r.url)
        m = re.search(r'@(-?\d+\.\d+),(-?\d+\.\d+)', final_url)
        if m:
            return f"{m.group(1)},{m.group(2)}"
    except Exception:
        pass
    return None


async def _download_image(url: str, developer_id: str) -> str:
    """Download an image from url into local media storage. Returns the relative media path."""
    import httpx

    if not url or not url.startswith("http"):
        return url

    try:
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        dev_dir = MEDIA_DIR / developer_id
        dev_dir.mkdir(parents=True, exist_ok=True)

        # Derive file extension from the URL path
        clean_path = url.split("?")[0].split("#")[0]
        raw_ext = clean_path.rsplit(".", 1)[-1].lower() if "." in clean_path else ""
        ext = raw_ext if raw_ext in _VALID_IMAGE_EXTS else "jpg"

        filename = f"{hashlib.md5(url.encode()).hexdigest()}.{ext}"
        filepath = dev_dir / filename
        media_path = f"/media/images/{developer_id}/{filename}"

        if filepath.exists():
            return media_path

        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code == 200:
                filepath.write_bytes(resp.content)
                return media_path
            logger.warning(f"Image download {resp.status_code}: {url}")
    except Exception as e:
        logger.warning(f"Image download error for {url}: {e}")

    return url  # fallback: keep original URL

celery_app = Celery(
    "proptech_scraper",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
)


@celery_app.task(name="scrape_developer")
def scrape_developer_task(developer_id: str, job_id: str):
    from database import get_db_context
    from app.models import ScrapeJob
    from app.models.scrape_job import JobStatus
    from datetime import datetime
    from uuid import UUID

    dev_uuid = UUID(developer_id)
    job_uuid = UUID(job_id)

    logger.info(f"Starting scrape for developer={developer_id} job={job_id}")

    with get_db_context() as db:
        job = db.query(ScrapeJob).filter(ScrapeJob.id == job_uuid).first()
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        job.status = JobStatus.RUNNING
        job.started_at = datetime.utcnow()
        db.commit()

    try:
        total = asyncio.run(_run_scrape(dev_uuid, job_uuid))

        with get_db_context() as db:
            job = db.query(ScrapeJob).filter(ScrapeJob.id == job_uuid).first()
            if job:
                job.status = JobStatus.COMPLETED
                job.finished_at = datetime.utcnow()
                job.total_records = total
                db.commit()

        logger.info(f"Scrape completed: {total} records for job={job_id}")
    except Exception as e:
        logger.error(f"Scrape error for job={job_id}: {e}", exc_info=True)
        with get_db_context() as db:
            job = db.query(ScrapeJob).filter(ScrapeJob.id == job_uuid).first()
            if job:
                from app.models.scrape_job import JobStatus
                job.status = JobStatus.FAILED
                job.finished_at = datetime.utcnow()
                job.error_log = str(e)[:4000]
                db.commit()



@celery_app.task(name="scrape_single_field")
def scrape_single_field_task(payload: dict):
    """Background task to scrape a single field using the current editor payload."""
    from database import get_db_context
    from uuid import UUID

    try:
        developer_id = UUID(payload["developer_id"])
        url_node_id = UUID(payload["url_node_id"])
    except Exception as e:
        logger.error(f"Invalid field scrape payload ids: {e}")
        return

    node_url = (payload.get("node_url") or "").strip()
    if not node_url:
        logger.error("Field scrape payload missing node_url")
        return

    field = payload.get("field") or {}
    selectors = [
        {"value": s.get("value", ""), "order": s.get("order", 0)}
        for s in sorted(field.get("selectors", []), key=lambda x: x.get("order", 0))
        if s.get("value", "").strip()
    ]
    field_snapshot = {
        "id": "field-runtime",
        "name": (field.get("name") or "field").strip().lower(),
        "is_child_url": bool(field.get("is_child_url")),
        "plain_text": bool(field.get("plain_text")),
        "is_shared": bool(field.get("is_shared")),
        "is_list": bool(field.get("is_list")),
        "list_container": (field.get("list_container") or "").strip(),
        "is_image": bool(field.get("is_image")),
        "extract_attr": (field.get("extract_attr") or "").strip(),
        "selectors": selectors,
    }

    node_snapshot = {
        "id": str(url_node_id),
        "parent_id": None,
        "name": "field-runner",
        "url": node_url,
        "container_selector": (payload.get("container_selector") or "").strip() or None,
        "order": 0,
        "fields": [field_snapshot],
    }

    logger.info(f"Starting single field scrape for developer={developer_id} node={url_node_id}")

    try:
        import asyncio
        from playwright.async_api import async_playwright

        async def _run_one():
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, args=_SCRAPER_LAUNCH_ARGS)
                ctx = await _new_scraper_context(browser)
                try:
                    return await _scrape_single_field(ctx, node_snapshot, developer_id=str(developer_id))
                finally:
                    await ctx.close()
                    await browser.close()

        total = asyncio.run(_run_one())
        logger.info(f"Field scrape completed: {total} items for node={url_node_id}")
    except Exception as e:
        logger.error(f"Field scrape error for node={url_node_id}: {e}", exc_info=True)


async def _new_scraper_context(browser):
    """Create a browser context that matches the visual selector setup exactly."""
    from playwright.async_api import Browser
    ctx = await browser.new_context(
        viewport={"width": 1280, "height": 720},
        user_agent=_SCRAPER_UA,
    )
    await ctx.add_init_script(_SCRAPER_STEALTH)
    return ctx


async def _run_scrape(developer_id, job_id) -> int:
    from database import get_db_context

    with get_db_context() as db:
        nodes_data = _snapshot_nodes(db, developer_id)

    if not nodes_data:
        return 0

    total = 0
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=_SCRAPER_LAUNCH_ARGS)
            ctx = await _new_scraper_context(browser)
            try:
                for root in nodes_data:
                    if root["parent_id"] is None:
                        count = await _scrape_node(ctx, root, nodes_data, developer_id, job_id)
                        total += count
            finally:
                await ctx.close()
                await browser.close()
    except Exception as e:
        logger.error(f"Playwright error: {e}", exc_info=True)
        raise

    return total


async def _scrape_single_field(ctx, node: dict, developer_id: str) -> int:
    """Preview scrape for a single field in the template editor (always a parent-level node)."""
    from database import get_db_context
    from app.models.proyecto import Proyecto
    from app.models.scraped_record import RecordStatus
    from uuid import UUID

    total = 0
    page = await ctx.new_page()
    try:
        await page.goto(node["url"], wait_until="networkidle", timeout=30000)
        await page.mouse.move(400, 300)
        await page.mouse.wheel(0, 500)
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        await page.wait_for_timeout(2000)

        items = await _extract_items(
            page,
            node["fields"],
            node.get("container_selector"),
            developer_id=str(developer_id),
        )

        with get_db_context() as db:
            for item_data in items:
                col_kwargs, extra = _map_data_to_columns(item_data, is_child=False)
                record = Proyecto(
                    developer_id=UUID(str(developer_id)),
                    status=RecordStatus.SUCCESS,
                    extra_data=extra,
                    **col_kwargs,
                )
                db.add(record)
            db.commit()
            total += len(items)
    finally:
        await page.close()

    return total


def _snapshot_nodes(db, developer_id) -> list:
    from app.models import ExtractionTemplate
    tmpl = db.query(ExtractionTemplate).filter(ExtractionTemplate.developer_id == developer_id).first()
    return list(tmpl.nodes) if tmpl and tmpl.nodes else []


async def _scrape_node(
    ctx, node: dict, all_nodes: list, developer_id, job_id,
    parent_url: str = None,
    proyecto_id=None,
) -> int:
    from database import get_db_context
    from app.models.proyecto import Proyecto
    from app.models.propiedad import Propiedad
    from app.models.scraped_record import RecordStatus
    from uuid import UUID

    is_child = bool(node.get("parent_id"))
    target_url = node["url"] or parent_url
    if not target_url:
        return 0

    # Names of shared fields in this node (is_shared=True in child → go to proyectos)
    shared_field_names = {f["name"] for f in node.get("fields", []) if f.get("is_shared")}

    total = 0
    try:
        page = await ctx.new_page()
        await page.goto(target_url, wait_until="networkidle", timeout=30000)
        await page.mouse.move(400, 300)
        await page.mouse.wheel(0, 500)
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        await page.wait_for_timeout(2000)

        items = await _extract_items(page, node["fields"], node.get("container_selector"), developer_id=str(developer_id))

        saved_proyecto_ids: list = []

        # Track gmaps_url that need coordinate resolution after the DB transaction
        _gmaps_to_resolve: list[tuple] = []  # list of (proyecto_id, gmaps_url)

        with get_db_context() as db:
            if is_child:
                # Shared fields in the child node → update the parent Proyecto record
                if proyecto_id and shared_field_names and items:
                    shared_vals = {k: v for k, v in items[0].items() if k in shared_field_names}
                    _update_proyecto_shared(db, proyecto_id, shared_vals)
                    # Queue coordinate resolution if gmaps_url was shared
                    gurl = shared_vals.get("gmaps_url")
                    if gurl and proyecto_id:
                        _gmaps_to_resolve.append((proyecto_id, gurl))

                for item_data in items:
                    child_data = {k: v for k, v in item_data.items() if k not in shared_field_names}
                    col_kwargs, extra = _map_data_to_columns(child_data, is_child=True)
                    # Skip records with no property-specific data (e.g. related-project cards)
                    if not any(v is not None and v != '' for v in col_kwargs.values()):
                        logger.debug("[scrape] skipping child item with no propiedad columns")
                        continue
                    # Skip records where modelo is a null placeholder (e.g. "null / m2 / dorms / 0 baños")
                    modelo_val = col_kwargs.get('modelo') or ''
                    if modelo_val.split('/')[0].strip().lower() == 'null':
                        logger.debug("[scrape] skipping child item with null modelo placeholder")
                        continue
                    record = Propiedad(
                        proyecto_id=proyecto_id,
                        status=RecordStatus.PENDING_REVIEW,
                        extra_data=extra,
                        **col_kwargs,
                    )
                    db.add(record)
                    db.flush()
                    saved_proyecto_ids.append(None)
            else:
                for item_data in items:
                    col_kwargs, extra = _map_data_to_columns(item_data, is_child=False)
                    record = Proyecto(
                        developer_id=UUID(str(developer_id)),
                        status=RecordStatus.SUCCESS,
                        extra_data=extra,
                        **col_kwargs,
                    )
                    db.add(record)
                    db.flush()
                    saved_proyecto_ids.append(record.id)
                    # Root node can also supply gmaps_url directly
                    if col_kwargs.get("gmaps_url") and not col_kwargs.get("gmaps_coordinates"):
                        _gmaps_to_resolve.append((record.id, col_kwargs["gmaps_url"]))
            db.commit()
            total += len(items)

        # Resolve Google Maps short URLs → coordinates (after DB transaction)
        for proj_id, gurl in _gmaps_to_resolve:
            coords = await _resolve_gmaps_coordinates(gurl)
            if coords:
                with get_db_context() as db2:
                    from app.models.proyecto import Proyecto as _Proj
                    proj = db2.query(_Proj).filter(_Proj.id == proj_id).first()
                    if proj and not proj.gmaps_coordinates:
                        proj.gmaps_coordinates = coords
                        db2.commit()
                        logger.info(f"[gmaps] resolved coords for proyecto {proj_id}: {coords}")

        # Process child nodes via is_child_url fields
        child_nodes = [n for n in all_nodes if n["parent_id"] == node["id"]]
        if child_nodes and not is_child:
            for idx, item_data in enumerate(items):
                item_proyecto_id = saved_proyecto_ids[idx] if idx < len(saved_proyecto_ids) else None
                for field in node["fields"]:
                    if field["is_child_url"] and item_data.get(field["name"]):
                        child_url = item_data[field["name"]]
                        for child_node in child_nodes:
                            count = await _scrape_node(
                                ctx, child_node, all_nodes, developer_id, job_id,
                                child_url,
                                proyecto_id=item_proyecto_id,
                            )
                            total += count

        await page.close()
    except Exception as e:
        logger.error(f"Error scraping node {node['id']} at {target_url}: {e}")

    return total


async def _get_element_value(page, el, field: dict) -> str | None:
    """Extract the appropriate value from a DOM element based on field config."""
    try:
        if field["is_child_url"]:
            val = await el.get_attribute("href")
            if val:
                from urllib.parse import urljoin
                val = urljoin(page.url, val)
            return val
        elif field.get("extract_attr"):
            val = await el.get_attribute(field["extract_attr"])
            # Lazy-load fallback: if src returned a data-URI placeholder, try the real URL attribute
            if val and val.startswith("data:") and field["extract_attr"] == "src":
                for lazy_attr in ("data-lazy-src", "data-src", "data-original", "data-srcset"):
                    real = await el.get_attribute(lazy_attr)
                    if real and not real.startswith("data:"):
                        val = real
                        break
            return val
        elif field.get("plain_text"):
            val = await el.evaluate("el => el.innerText")
            return val.strip() if val else None
        else:
            val = await el.text_content()
            return val.strip() if val else None
    except Exception as e:
        logger.warning(f"Value extraction error for field {field['name']}: {e}")
        return None


async def _extract_items(page, fields: list, container_selector: str = None, developer_id: str = None) -> list:
    if not fields:
        return []

    results = []
    shared_fields = [f for f in fields if f.get("is_shared")]
    card_fields = [f for f in fields if not f.get("is_shared")]

    # --- Shared fields: extract once from the page ---
    shared_data: dict = {}
    for field in shared_fields:
        empty = [] if field.get("is_list") else None
        if not field["selectors"]:
            shared_data[field["name"]] = empty
            continue
        css = " ".join(s["value"] for s in field["selectors"])
        try:
            if field.get("is_list"):
                scope = page
                if field.get("list_container"):
                    scope = await page.query_selector(field["list_container"])
                if scope:
                    els = await scope.query_selector_all(css)
                    values = [await _get_element_value(page, el, field) for el in els]
                    shared_data[field["name"]] = [v for v in values if v is not None]
                else:
                    shared_data[field["name"]] = []
            else:
                el = await page.query_selector(css)
                shared_data[field["name"]] = await _get_element_value(page, el, field) if el else None
        except Exception as e:
            logger.warning(f"Shared field error for {field['name']}: {e}")
            shared_data[field["name"]] = empty

    # --- Card fields: container-based or positional ---
    if container_selector and card_fields:
        try:
            containers = await page.query_selector_all(container_selector)
            for container in containers:
                item = {**shared_data}
                for field in card_fields:
                    empty = [] if field.get("is_list") else None
                    if not field["selectors"]:
                        item[field["name"]] = empty
                        continue
                    css = " ".join(s["value"] for s in field["selectors"])
                    try:
                        if field.get("is_list"):
                            scope = container
                            if field.get("list_container"):
                                scope = await container.query_selector(field["list_container"])
                            if scope:
                                els = await scope.query_selector_all(css)
                                values = [await _get_element_value(page, el, field) for el in els]
                                item[field["name"]] = [v for v in values if v is not None]
                            else:
                                item[field["name"]] = []
                        else:
                            el = await container.query_selector(css)
                            if el is None:
                                # Fallback: the container itself may match the selector
                                # (e.g. container IS the <a> and field selector is also <a>)
                                try:
                                    if await container.evaluate("(el, sel) => el.matches(sel)", css):
                                        el = container
                                except Exception:
                                    pass
                            item[field["name"]] = await _get_element_value(page, el, field) if el else None
                    except Exception as e:
                        logger.warning(f"Container field error for {field['name']}: {e}")
                        item[field["name"]] = empty
                results.append(item)
        except Exception as e:
            logger.error(f"Container extraction error: {e}")

    elif card_fields:
        # Fallback: positional grouping by index
        field_values: dict = {}
        max_count = 0
        for field in card_fields:
            if not field["selectors"]:
                continue
            css = " ".join(s["value"] for s in field["selectors"])
            try:
                elements = await page.query_selector_all(css)
                if field.get("is_list"):
                    scope = page
                    if field.get("list_container"):
                        scope = await page.query_selector(field["list_container"])
                    if scope:
                        elements = await scope.query_selector_all(css)
                        values = [await _get_element_value(page, el, field) for el in elements]
                    else:
                        values = []
                    field_values[field["name"]] = [[v for v in values if v is not None]]
                    max_count = max(max_count, 1)
                else:
                    values = [await _get_element_value(page, el, field) for el in elements]
                    field_values[field["name"]] = values
                    max_count = max(max_count, len(values))
            except Exception as e:
                logger.warning(f"Selector error for field {field['name']}: {e}")
                field_values[field["name"]] = []

        for i in range(max_count):
            item = {**shared_data}
            for fname, vals in field_values.items():
                item[fname] = vals[i] if i < len(vals) else None
            results.append(item)

    elif shared_data:
        # Only shared fields — emit a single record
        results.append(shared_data)

    # --- Download images for is_image fields ---
    if developer_id:
        image_fields = [f for f in fields if f.get("is_image")]
        for field in image_fields:
            fname = field["name"]
            for item in results:
                val = item.get(fname)
                if val is None:
                    continue
                if isinstance(val, list):
                    item[fname] = [
                        await _download_image(v, developer_id)
                        if isinstance(v, str) and v.startswith("http") else v
                        for v in val
                    ]
                elif isinstance(val, str) and val.startswith("http"):
                    item[fname] = await _download_image(val, developer_id)

    return results
