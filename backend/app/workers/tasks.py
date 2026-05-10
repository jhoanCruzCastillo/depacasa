"""Celery tasks for background scraping"""

import logging
import asyncio
import sys
import hashlib
from pathlib import Path

# Ensure the backend root (/app) is in sys.path for Celery workers
if '/app' not in sys.path:
    sys.path.insert(0, '/app')

from celery import Celery
from config import settings

logger = logging.getLogger(__name__)

MEDIA_DIR = Path("/app/media/images")
_VALID_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "gif", "avif", "svg"}


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
    from app.models import ScrapeJob, UrlNode, Field, Selector, ScrapedRecord
    from app.models.scrape_job import JobStatus
    from app.models.scraped_record import RecordStatus
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


async def _run_scrape(developer_id, job_id) -> int:
    from database import get_db_context
    from app.models import UrlNode

    with get_db_context() as db:
        root_nodes = db.query(UrlNode).filter(
            UrlNode.developer_id == developer_id,
            UrlNode.parent_id == None,
        ).order_by(UrlNode.order).all()

        if not root_nodes:
            return 0

        # Snapshot all nodes/fields/selectors to avoid lazy-load issues outside session
        nodes_data = _snapshot_nodes(db, developer_id)

    total = 0
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                for root in nodes_data:
                    if root["parent_id"] is None:
                        count = await _scrape_node(browser, root, nodes_data, developer_id, job_id)
                        total += count
            finally:
                await browser.close()
    except Exception as e:
        logger.error(f"Playwright error: {e}", exc_info=True)
        raise

    return total


def _snapshot_nodes(db, developer_id) -> list:
    from app.models import UrlNode

    nodes = db.query(UrlNode).filter(UrlNode.developer_id == developer_id).all()
    result = []
    for n in nodes:
        fields = []
        for f in sorted(n.fields, key=lambda x: x.order):
            selectors = [{"value": s.value, "order": s.order} for s in sorted(f.selectors, key=lambda x: x.order)]
            fields.append({"id": str(f.id), "name": f.name, "is_child_url": f.is_child_url, "plain_text": f.plain_text, "is_shared": f.is_shared, "is_list": f.is_list, "list_container": f.list_container, "is_image": f.is_image, "extract_attr": f.extract_attr, "selectors": selectors})
        result.append({"id": str(n.id), "parent_id": str(n.parent_id) if n.parent_id else None, "name": n.name, "url": n.url, "container_selector": n.container_selector, "order": n.order, "fields": fields})
    return result


async def _scrape_node(browser, node: dict, all_nodes: list, developer_id, job_id, parent_url: str = None) -> int:
    from database import get_db_context
    from app.models import ScrapedRecord
    from app.models.scraped_record import RecordStatus
    from uuid import UUID

    target_url = node["url"] or parent_url
    if not target_url:
        return 0

    total = 0
    try:
        page = await browser.new_page()
        await page.goto(target_url, wait_until="networkidle", timeout=30000)
        # Simulate user interaction to trigger WP Rocket lazy-loaded scripts
        # (CF7 and other scripts only load after keydown/mousemove/wheel events)
        await page.mouse.move(400, 300)
        await page.mouse.wheel(0, 500)
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        # Wait for lazy scripts to load and initialize the DOM
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        await page.wait_for_timeout(2000)

        items = await _extract_items(page, node["fields"], node.get("container_selector"), developer_id=str(developer_id))

        with get_db_context() as db:
            for item_data in items:
                record = ScrapedRecord(
                    developer_id=UUID(str(developer_id)),
                    url_node_id=UUID(node["id"]),
                    source_url=target_url,
                    data=item_data,
                    status=RecordStatus.SUCCESS,
                )
                db.add(record)
            db.commit()
            total += len(items)

        # Process child nodes via is_child_url fields
        child_nodes = [n for n in all_nodes if n["parent_id"] == node["id"]]
        if child_nodes:
            for item_data in items:
                for field in node["fields"]:
                    if field["is_child_url"] and item_data.get(field["name"]):
                        child_url = item_data[field["name"]]
                        for child_node in child_nodes:
                            count = await _scrape_node(browser, child_node, all_nodes, developer_id, job_id, child_url)
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
