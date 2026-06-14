from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from playwright.async_api import async_playwright, Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeoutError

from config import settings

logger = logging.getLogger(__name__)

# ── Shared AI prompt for all capture methods ──────────────────────────────────
_SCRAPE_SYSTEM_MSG = (
    "Eres un experto en web scraping de portales inmobiliarios peruanos.\n"
    "Analizas imágenes de páginas web y HTML para generar plantillas de extracción JSON precisas.\n\n"
    "NOMBRES DE CAMPO ESTÁNDAR (usa exactamente estos nombres):\n"
    "  Catálogo (listado): nombre, estado_del_proyecto, ubicacion, precio_desde,\n"
    "    imagen, url_propiedad, descripcion, areas_comunes, areas_comunes_imagenes,\n"
    "    areas_comunes_exterior_e_interior_img, lugares_cercanos\n"
    "  Detalle (propiedad): imagen_modelo, dormitorios, m2, modelo, modelo_imagen,\n"
    "    descripcion, ubicacion, lugares_cercanos, areas_comunes, areas_comunes_imagenes,\n"
    "    areas_comunes_exterior_e_interior_img, gmaps_url, gmaps_coordinates\n\n"
    "REGLAS DE SELECTORES (MUY IMPORTANTE):\n"
    "  - El selector de cada campo debe apuntar al ELEMENTO EXACTO que contiene el valor:\n"
    "      imagen / imagen_modelo / modelo_imagen → selector debe ser el <img> directamente\n"
    "      url_propiedad / gmaps_url              → selector debe ser el <a> directamente\n"
    "      texto (nombre, precio, etc.)            → selector del elemento más interno con el texto (<h2>, <span>, <p>, etc.)\n"
    "  - NO selecciones contenedores padre genéricos si el valor está en un hijo específico\n"
    "  - Usa clases significativas o combinaciones tag+clase, evita nth-child frágiles\n"
    "  - Para cards repetidos: card_selector = raíz del card; field.selector = relativo al card\n"
    "  - Para páginas de detalle: field.selector = selector absoluto desde el documento\n\n"
    "REGLAS DE FLAGS:\n"
    "  - is_child_url:true  → url_propiedad (enlace al detalle del proyecto)\n"
    "  - is_image:true      → cualquier campo que extrae una URL de imagen\n"
    "  - extract_attr:'src' → para campos is_image (extraer el atributo src del <img>)\n"
    "  - extract_attr:'href'→ para is_child_url y gmaps_url (extraer el href del <a>)\n"
    "  - is_list:true       → OBLIGATORIO cuando el selector apunta a MÚLTIPLES elementos repetidos "
    "(galerías de imágenes, listas de categorías/amenidades, colecciones de items). "
    "Se aplica SIEMPRE a: lugares_cercanos, areas_comunes, areas_comunes_imagenes, "
    "areas_comunes_exterior_e_interior_img, imagen (cuando hay varias fotos del proyecto).\n"
    "  - needs_hover:true   → si el hover del mouse reveló contenido normalmente oculto\n\n"
    "TIPO DE SECCIÓN:\n"
    "  - section_type:'catalog' → elementos que se repiten (cards) → incluir card_selector\n"
    "  - section_type:'detail'  → campos únicos de página de detalle → omitir card_selector\n"
    "  - catalog_type: proyectos | propiedades | imagenes | areas_comunes | zonas_cercanas\n\n"
    "Ejemplos de salida válida:\n"
    "Catálogo de proyectos:\n"
    '{"section_type":"catalog","catalog_type":"proyectos","needs_hover":false,'
    '"card_selector":"article.project-card","fields":['
    '{"name":"nombre","selector":"h2.project-name","type":"text","is_image":false,"is_child_url":false,"is_list":false,"extract_attr":null},'
    '{"name":"imagen","selector":"img.project-thumb","type":"image","is_image":true,"is_child_url":false,"is_list":false,"extract_attr":"src"},'
    '{"name":"url_propiedad","selector":"a.project-link","type":"url","is_image":false,"is_child_url":true,"is_list":false,"extract_attr":"href"}'
    '],"confidence":0.9}\n'
    "Detalle con lista de valores (jsonb):\n"
    '{"section_type":"detail","needs_hover":false,"fields":['
    '{"name":"lugares_cercanos","selector":"div.facilidad-item span.facilidad-titulo","type":"text","is_image":false,"is_child_url":false,"is_list":true,"extract_attr":null},'
    '{"name":"areas_comunes","selector":"li.amenidad-nombre","type":"text","is_image":false,"is_child_url":false,"is_list":true,"extract_attr":null}'
    '],"confidence":0.9}'
)


@dataclass
class VisualSelectorSession:
    id: str
    context: BrowserContext
    page: Page
    created_at: datetime
    url: str
    viewport: Dict[str, int]
    page_detail: Optional[Any] = field(default=None)  # Page | None
    active_tab: str = field(default="listing")
    last_used_at: datetime = field(default_factory=datetime.utcnow)


class VisualSelectorManager:
    def __init__(self) -> None:
        self._sessions: Dict[str, VisualSelectorSession] = {}
        self._lock = asyncio.Lock()
        self._playwright = None
        self._browser: Optional[Browser] = None

    async def _get_browser(self) -> Browser:
        if not self._playwright:
            self._playwright = await async_playwright().start()
        if not self._browser:
            self._browser = await self._playwright.chromium.launch(headless=True)
        return self._browser

    def _active_page(self, session: VisualSelectorSession) -> Page:
        if session.active_tab == "detail" and session.page_detail:
            return session.page_detail
        return session.page

    async def _evict_oldest(self) -> None:
        """Close the least-recently-used session to make room for a new one."""
        if not self._sessions:
            return
        oldest_id = min(self._sessions, key=lambda sid: self._sessions[sid].last_used_at)
        logger.info("Evicting oldest session %s to make room", oldest_id)
        session = self._sessions.pop(oldest_id)
        try:
            if session.page_detail:
                await session.page_detail.close()
        except Exception:
            pass
        try:
            await session.context.close()
        except Exception:
            pass

    async def create_session(self, url: str, viewport: Dict[str, int]) -> VisualSelectorSession:
        if not re.match(r"^https?://", url):
            raise ValueError("Solo se permiten URLs con protocolo http:// o https://")

        async with self._lock:
            # Instead of rejecting, evict the oldest stale session when at capacity
            while len(self._sessions) >= settings.MAX_BROWSER_SESSIONS:
                await self._evict_oldest()

            browser = await self._get_browser()
            context = await browser.new_context(
                viewport=viewport,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            page = await context.new_page()
            page.set_default_timeout(30_000)

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                try:
                    await page.wait_for_load_state("load", timeout=8_000)
                except PlaywrightTimeoutError:
                    pass
            except PlaywrightTimeoutError as exc:
                await context.close()
                raise RuntimeError("Tiempo de carga excedido (30s). Revisa la URL.") from exc

            try:
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(1500)
            except Exception:
                pass

            session_id = str(uuid4())
            session = VisualSelectorSession(
                id=session_id,
                context=context,
                page=page,
                created_at=datetime.utcnow(),
                url=url,
                viewport=page.viewport_size or viewport,
            )
            self._sessions[session_id] = session
            return session

    def get_session(self, session_id: str) -> VisualSelectorSession:
        session = self._sessions.get(session_id)
        if not session:
            raise KeyError("Sesión no encontrada")
        session.last_used_at = datetime.utcnow()
        return session

    async def close_session(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if not session:
            return
        try:
            if session.page_detail:
                await session.page_detail.close()
        except Exception:
            pass
        await session.context.close()

    async def scroll_to(self, session_id: str, scroll_y: int) -> str:
        session = self.get_session(session_id)
        page = self._active_page(session)
        await page.evaluate(f"window.scrollTo({{top: {max(0, scroll_y)}, behavior: 'instant'}})")
        await page.wait_for_timeout(50)
        return await self.screenshot(session_id)

    async def screenshot(self, session_id: str, quality: int = 72) -> str:
        session = self.get_session(session_id)
        page = self._active_page(session)
        raw = await page.screenshot(type="jpeg", quality=quality)
        return "data:image/jpeg;base64," + base64.b64encode(raw).decode("utf-8")

    async def free_click(self, session_id: str, x: int, y: int) -> str:
        session = self.get_session(session_id)
        page = self._active_page(session)
        await page.mouse.click(x, y)
        await page.wait_for_timeout(350)
        return await self.screenshot(session_id)

    async def hover_at(self, session_id: str, x: int, y: int) -> None:
        session = self.get_session(session_id)
        page = self._active_page(session)
        await page.evaluate(
            """
            ({x, y}) => {
                const el = document.elementFromPoint(x, y);
                if (!el) return;
                if (window.__vs_prev) {
                    window.__vs_prev.style.outline = "";
                }
                el.style.outline = "2px solid #ef4444";
                el.style.outlineOffset = "1px";
                window.__vs_prev = el;
            }
            """,
            {"x": x, "y": y},
        )

    async def select_at(self, session_id: str, x: int, y: int) -> Dict[str, Any]:
        session = self.get_session(session_id)
        page = self._active_page(session)
        payload = await page.evaluate(
            """
            ({x, y}) => {
                const el = document.elementFromPoint(x, y);
                if (!el) return null;
                const escape = (value) => {
                    if (window.CSS && CSS.escape) return CSS.escape(value);
                    return value.replace(/([ #;?%&,.+*~\\':"!^$[\\]()=>|\\/])/g,'\\\\$1');
                };
                const selectorFor = (node) => {
                    if (!node || !node.tagName) return "";
                    if (node.id) return `#${escape(node.id)}`;
                    const parts = [];
                    let current = node;
                    let depth = 0;
                    while (current && current.tagName && depth < 4) {
                        let part = current.tagName.toLowerCase();
                        const cls = (current.className || "").toString().trim().split(/\\s+/).filter(Boolean);
                        if (cls.length) {
                            part += "." + escape(cls[0]);
                        }
                        const parent = current.parentElement;
                        if (parent) {
                            const siblings = Array.from(parent.children).filter(child => child.tagName === current.tagName);
                            if (siblings.length > 1) {
                                const index = siblings.indexOf(current) + 1;
                                part += `:nth-of-type(${index})`;
                            }
                        }
                        parts.unshift(part);
                        current = current.parentElement;
                        depth += 1;
                    }
                    return parts.join(" > ");
                };
                const selector = selectorFor(el);
                const href = el.getAttribute("href");
                const text = (el.innerText || "").trim();
                return {
                    selector,
                    html: el.outerHTML,
                    text,
                    tag_name: el.tagName.toLowerCase(),
                    preview: href || text,
                };
            }
            """,
            {"x": x, "y": y},
        )

        if not payload or not payload.get("selector"):
            raise ValueError("No se pudo capturar el elemento seleccionado.")

        try:
            matches = await page.locator(payload["selector"]).count()
        except (PlaywrightTimeoutError, ValueError) as exc:
            logger.warning("Selector inválido o sin coincidencias: %s", exc)
            matches = 0

        payload["matches"] = matches
        return payload

    # ── NEW: Rectangle-based selection ───────────────────────────────────────

    async def hover_coords(self, session_id: str, x: int, y: int, wait_ms: int = 700) -> str:
        """Move the real mouse pointer to (x, y) to trigger :hover CSS and JS events."""
        session = self.get_session(session_id)
        page = self._active_page(session)
        await page.mouse.move(x, y)
        await page.wait_for_timeout(wait_ms)
        return await self.screenshot(session_id)

    async def scan_and_hover(
        self, session_id: str, x1: int, y1: int, x2: int, y2: int
    ) -> str:
        """Identify elements with :hover CSS rules inside the rect and activate the best one."""
        session = self.get_session(session_id)
        page = self._active_page(session)
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2

        # Find the best hoverable element within the drawn rect
        target = await page.evaluate(
            """
            ({x1, y1, x2, y2, cx, cy}) => {
                // Collect all CSS selectors that have :hover rules
                const hoverSelectors = [];
                try {
                    for (const sheet of document.styleSheets) {
                        try {
                            for (const rule of sheet.cssRules || []) {
                                const sel = rule.selectorText || '';
                                if (sel.includes(':hover')) {
                                    // Strip :hover (and anything after it until comma/end)
                                    const base = sel
                                        .split(',')
                                        .map(s => s.replace(/:{1,2}hover[^,]*/g, '').trim())
                                        .filter(Boolean)
                                        .join(',');
                                    if (base) hoverSelectors.push(base);
                                }
                            }
                        } catch (_) {}
                    }
                } catch (_) {}

                // Build a set of elements that match hover rules
                const hoverSet = new Set();
                for (const sel of hoverSelectors) {
                    try {
                        document.querySelectorAll(sel).forEach(el => hoverSet.add(el));
                    } catch (_) {}
                }

                // Walk down from the element stack at the rect center
                const stack = document.elementsFromPoint(cx, cy);
                for (const el of stack) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    // Must be inside (or closely overlapping) the drawn rectangle
                    if (rect.right < x1 - 20 || rect.left > x2 + 20 ||
                        rect.bottom < y1 - 20 || rect.top > y2 + 20) continue;
                    const style = window.getComputedStyle(el);
                    const hasPointer = style.cursor === 'pointer';
                    const hasHoverRule = hoverSet.has(el);
                    if (hasHoverRule || hasPointer) {
                        return {
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2,
                            tag: el.tagName.toLowerCase(),
                            matched: hasHoverRule ? 'css_rule' : 'pointer_cursor',
                        };
                    }
                }
                // Fallback: center of rect
                return { x: cx, y: cy, tag: 'fallback', matched: 'center' };
            }
            """,
            {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "cx": cx, "cy": cy},
        )

        logger.info(
            "scan_and_hover: moving to (%.0f, %.0f) tag=%s matched=%s",
            target["x"], target["y"], target.get("tag"), target.get("matched"),
        )
        await page.mouse.move(target["x"], target["y"])
        await page.wait_for_timeout(650)
        screenshot = await self.screenshot(session_id)
        return screenshot

    async def select_rect(
        self, session_id: str, x1: int, y1: int, x2: int, y2: int, hover: bool = False
    ) -> Dict[str, Any]:
        """Find the best CSS selector for the element covered by the drawn rectangle.
        If hover=True, move the mouse to the center first so :hover content appears."""
        session = self.get_session(session_id)
        page = self._active_page(session)
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2
        rect_w = x2 - x1
        rect_h = y2 - y1

        if hover:
            await page.mouse.move(cx, cy)
            await page.wait_for_timeout(700)

        payload = await page.evaluate(
            """
            ({x1, y1, x2, y2, cx, cy, rectW, rectH}) => {
                const isLargeRect = rectW > 100 && rectH > 80;
                let el = document.elementFromPoint(cx, cy);
                if (!el) return null;

                if (isLargeRect) {
                    // Walk up to find element that fully contains the drawn rect
                    let candidate = el;
                    while (candidate && candidate.parentElement &&
                           candidate.parentElement !== document.body) {
                        const bbox = candidate.getBoundingClientRect();
                        if (bbox.left <= x1 + 20 && bbox.top <= y1 + 20 &&
                            bbox.right  >= x2 - 20 && bbox.bottom >= y2 - 20) {
                            break;
                        }
                        candidate = candidate.parentElement;
                    }
                    el = candidate;
                }

                const escape = (v) => (window.CSS && CSS.escape) ? CSS.escape(v)
                    : v.replace(/([ #;?%&,.+*~\\':"!^$[\\]()=>|\\/])/g,'\\\\$1');

                const selectorFor = (node) => {
                    if (!node || !node.tagName) return "";
                    if (node.id) return "#" + escape(node.id);
                    const parts = [];
                    let current = node;
                    let depth = 0;
                    while (current && current.tagName && depth < 4) {
                        let part = current.tagName.toLowerCase();
                        const cls = (current.className || "").toString().trim().split(/\\s+/).filter(Boolean);
                        if (cls.length) part += "." + escape(cls[0]);
                        const parent = current.parentElement;
                        if (parent) {
                            const sibs = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                            if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(current) + 1) + ")";
                        }
                        parts.unshift(part);
                        current = current.parentElement;
                        depth++;
                    }
                    return parts.join(" > ");
                };

                const selector = selectorFor(el);
                const href = el.getAttribute("href") || el.querySelector("a")?.getAttribute("href");
                const src  = el.getAttribute("src")  || el.querySelector("img")?.getAttribute("src");
                const text = (el.innerText || el.textContent || "").trim().slice(0, 200);
                const tagName = el.tagName.toLowerCase();

                return { selector, tag_name: tagName, text, href, src, preview: href || src || text };
            }
            """,
            {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "cx": cx, "cy": cy, "rectW": rect_w, "rectH": rect_h},
        )

        if not payload or not payload.get("selector"):
            raise ValueError("No se encontró elemento en el área seleccionada.")

        try:
            matches = await page.locator(payload["selector"]).count()
        except Exception:
            matches = 0

        payload["matches"] = matches
        return payload

    async def infer_field_from_label(
        self,
        session_id: str,
        selector: str,
        label: str,
        parent_label: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Use AI to infer field_name and field_type from the user's natural language label."""
        session = self.get_session(session_id)
        page = self._active_page(session)

        try:
            content = await page.evaluate(
                """
                (sel) => {
                    try {
                        const el = document.querySelector(sel);
                        if (!el) return "";
                        return el.getAttribute("href") || el.getAttribute("src")
                            || (el.innerText || "").trim().slice(0, 120);
                    } catch (e) { return ""; }
                }
                """,
                selector,
            )
        except Exception:
            content = ""

        if not settings.ANTHROPIC_API_KEY:
            return self._heuristic_field(label)

        parent_ctx = f" Pertenece al contenedor: '{parent_label}'." if parent_label else ""
        prompt = (
            f"El usuario dibujó un rectángulo sobre un elemento web y lo describió como: '{label}'.\n"
            f"El elemento tiene selector CSS '{selector}' con contenido: '{content[:120]}'.{parent_ctx}\n\n"
            "Devuelve SOLO este JSON (sin texto adicional):\n"
            '{"field_name": "nombre_en_snake_case", "field_type": "text|url|image|number|container", "confidence": 0.9}\n\n'
            "Reglas:\n"
            "- 'container' si describe una tarjeta/card/item que se repite en un listado\n"
            "- 'url' si es un enlace, link, botón que navega a otra página\n"
            "- 'image' si es imagen/foto/thumbnail/galería\n"
            "- 'number' si es precio, m2, metros, dormitorios, habitaciones, área\n"
            "- 'text' para nombres, títulos, ubicaciones, descripciones\n"
            "- field_name: descriptivo, máx 30 chars, snake_case, en español sin tildes"
        )

        ai_payload = {
            "model": settings.ANTHROPIC_MODEL,
            "max_tokens": 150,
            "temperature": 0.1,
            "system": "Clasificas elementos web para scraping inmobiliario. Responde SOLO con el JSON pedido, nada más.",
            "messages": [{"role": "user", "content": prompt}],
        }
        headers = {
            "x-api-key": settings.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=ai_payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()

            raw = "".join(item.get("text", "") for item in data.get("content", []) if item.get("type") == "text")
            result = extract_json(raw)
            result.setdefault("confidence", 0.8)
            return result
        except Exception as exc:
            logger.warning("AI field inference failed, falling back to heuristic: %s", exc)
            return self._heuristic_field(label)

    def _heuristic_field(self, label: str) -> Dict[str, Any]:
        ll = label.lower()
        if any(w in ll for w in ["card", "tarjeta", "item", "contenedor", "container", "proyecto", "propiedad", "listing", "ficha"]):
            return {"field_name": "card", "field_type": "container", "confidence": 0.7}
        if any(w in ll for w in ["link", "url", "enlace", "detalle", "naveg", "ver más", "ver mas"]):
            return {"field_name": "url_detalle", "field_type": "url", "confidence": 0.75}
        if any(w in ll for w in ["imagen", "foto", "img", "photo", "thumbnail", "galeria", "galería"]):
            return {"field_name": "imagen", "field_type": "image", "confidence": 0.8}
        if any(w in ll for w in ["precio", "m2", "metros", "dormitorio", "habitacion", "habitación", "baño", "area", "área"]):
            fn = _to_field_name(ll)
            return {"field_name": fn[:30], "field_type": "number", "confidence": 0.7}
        fn = _to_field_name(ll)
        return {"field_name": fn[:30], "field_type": "text", "confidence": 0.6}

    # ── Detail tab ────────────────────────────────────────────────────────────

    async def open_detail_tab(self, session_id: str, url: str) -> str:
        """Open a second browser page for the detail URL."""
        session = self.get_session(session_id)
        if session.page_detail:
            try:
                await session.page_detail.close()
            except Exception:
                pass
            session.page_detail = None

        page_detail = await session.context.new_page()
        page_detail.set_default_timeout(30_000)
        try:
            await page_detail.goto(url, wait_until="domcontentloaded", timeout=30_000)
            try:
                await page_detail.wait_for_load_state("load", timeout=8_000)
            except PlaywrightTimeoutError:
                pass
        except PlaywrightTimeoutError as exc:
            await page_detail.close()
            raise RuntimeError(f"Tiempo de carga excedido al abrir detalle: {url}") from exc

        session.page_detail = page_detail
        session.active_tab = "detail"
        return await self.screenshot(session_id)

    async def switch_tab(self, session_id: str, tab: str) -> str:
        session = self.get_session(session_id)
        if tab == "detail" and not session.page_detail:
            raise ValueError("La pestaña de detalle aún no está disponible.")
        session.active_tab = tab
        # Reset scroll to 0 so frontend scrollYRef and backend stay in sync
        page = self._active_page(session)
        try:
            await page.evaluate("window.scrollTo(0, 0)")
            await page.wait_for_timeout(100)
        except Exception:
            pass
        return await self.screenshot(session_id)

    async def get_card_url(self, session_id: str, x: int, y: int) -> Optional[str]:
        """Return the href of the link at (x, y) on the listing page."""
        session = self.get_session(session_id)
        url = await session.page.evaluate(
            """
            ({x, y}) => {
                const el = document.elementFromPoint(x, y);
                if (!el) return null;
                const link = el.tagName === 'A' ? el : el.closest('a');
                if (link) return link.href || link.getAttribute('href');
                return null;
            }
            """,
            {"x": x, "y": y},
        )
        return url or None

    async def get_url_from_selector(self, session_id: str, selector: str) -> Optional[str]:
        """Extract the href of the first element matching selector on the listing page."""
        session = self.get_session(session_id)
        url = await session.page.evaluate(
            """
            (sel) => {
                try {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    if (el.tagName === 'A') return el.href || null;
                    const a = el.querySelector('a');
                    return a ? (a.href || null) : null;
                } catch (e) { return null; }
            }
            """,
            selector,
        )
        return url or None

    # ── Validation (unchanged) ────────────────────────────────────────────────

    async def validate_selectors(
        self,
        session_id: str,
        card_selector: Optional[str],
        fields: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        session = self.get_session(session_id)
        page = self._active_page(session)
        result = await page.evaluate(
            """
            ({cardSelector, fields}) => {
                const output = { card_count: 0, results: [], preview: [] };
                const normalize = (value) => (value || "").trim();
                const extractValue = (el, type) => {
                    if (!el) return null;
                    if (type === "url") { const href = el.getAttribute("href"); return href || null; }
                    if (type === "image") { const src = el.getAttribute("src"); return src || null; }
                    return normalize(el.innerText || el.textContent || "");
                };

                if (cardSelector) {
                    const cards = Array.from(document.querySelectorAll(cardSelector));
                    output.card_count = cards.length;
                    fields.forEach((field) => {
                        let found = 0, missing = 0;
                        cards.forEach((card) => {
                            const el = card.querySelector(field.selector);
                            if (extractValue(el, field.type)) found += 1;
                            else missing += 1;
                        });
                        output.results.push({ name: field.name, selector: field.selector, found, missing, total: cards.length });
                    });
                    output.preview = cards.map((card) => {
                        const item = {};
                        fields.forEach((field) => {
                            const el = card.querySelector(field.selector);
                            item[field.name] = extractValue(el, field.type);
                        });
                        return item;
                    });
                    return output;
                }

                fields.forEach((field) => {
                    const elements = Array.from(document.querySelectorAll(field.selector));
                    output.results.push({ name: field.name, selector: field.selector, found: elements.length, missing: 0, total: elements.length });
                    if (output.preview.length < 3) {
                        elements.slice(0, 3).forEach((el, idx) => {
                            if (!output.preview[idx]) output.preview[idx] = {};
                            output.preview[idx][field.name] = extractValue(el, field.type);
                        });
                    }
                });
                return output;
            }
            """,
            {"cardSelector": card_selector, "fields": fields},
        )
        return result

    async def capture_and_analyze_rect(
        self,
        session_id: str,
        x1: int, y1: int, x2: int, y2: int,
        hover: bool = False,
        context: str = "",
        ai_model: str = "",
    ) -> Dict[str, Any]:
        """Screenshot the drawn rect + page context, then use AI vision to generate a full extraction template."""
        session = self.get_session(session_id)
        page = self._active_page(session)

        if hover:
            await page.mouse.move((x1 + x2) // 2, (y1 + y2) // 2)
            await page.wait_for_timeout(700)

        # Crop screenshot of the selected rectangle
        w, h = max(1, x2 - x1), max(1, y2 - y1)
        rect_raw = await page.screenshot(
            type="jpeg", quality=88,
            clip={"x": x1, "y": y1, "width": w, "height": h},
        )
        rect_b64 = base64.b64encode(rect_raw).decode("utf-8")

        # Full viewport screenshot for context
        full_raw = await page.screenshot(type="jpeg", quality=70)
        full_b64 = base64.b64encode(full_raw).decode("utf-8")

        # If no context → take extra section screenshots by scrolling
        section_b64_list: List[str] = []
        if not context.strip():
            try:
                page_height = await page.evaluate("document.body.scrollHeight")
                vp_height = session.viewport.get("height", 720)
                orig_scroll = int(await page.evaluate("window.pageYOffset"))
                positions = list(range(vp_height, min(int(page_height), vp_height * 4), vp_height))[:3]
                for pos in positions:
                    await page.evaluate(f"window.scrollTo(0, {pos})")
                    await page.wait_for_timeout(200)
                    sec_raw = await page.screenshot(type="jpeg", quality=55)
                    section_b64_list.append(base64.b64encode(sec_raw).decode("utf-8"))
                await page.evaluate(f"window.scrollTo(0, {orig_scroll})")
                await page.wait_for_timeout(150)
            except Exception as exc:
                logger.warning("Section screenshots failed: %s", exc)

        # HTML context around the drawn element
        html_context = ""
        try:
            html_context = await page.evaluate(
                """
                ({x1, y1, x2, y2}) => {
                    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                    let el = document.elementFromPoint(cx, cy);
                    if (!el) return '';
                    let candidate = el;
                    while (candidate && candidate.parentElement && candidate.parentElement !== document.body) {
                        const r = candidate.getBoundingClientRect();
                        if (r.left <= x1 + 30 && r.top <= y1 + 30 && r.right >= x2 - 30 && r.bottom >= y2 - 30)
                            break;
                        candidate = candidate.parentElement;
                    }
                    const parent = candidate.parentElement;
                    return (parent ? parent.outerHTML : candidate.outerHTML).slice(0, 8000);
                }
                """,
                {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            )
        except Exception as exc:
            logger.warning("HTML context extraction failed: %s", exc)

        model = ai_model or settings.ANTHROPIC_MODEL
        is_openai = model.lower().startswith(("gpt-", "o1-", "o3-", "o4-"))

        context_line = f"Contexto del usuario: «{context}»\n\n" if context.strip() else ""
        hover_line = "IMPORTANTE: El hover estaba ACTIVADO en el rectángulo seleccionado (el contenido puede haber sido revelado por CSS :hover).\n\n" if hover else ""

        system_msg = _SCRAPE_SYSTEM_MSG

        user_text = (
            f"{context_line}{hover_line}"
            "Imagen 1: ÁREA SELECCIONADA por el usuario (rectángulo dibujado).\n"
            "Imagen 2: PÁGINA COMPLETA (contexto visual).\n"
        )
        if section_b64_list:
            user_text += f"Imágenes 3-{2 + len(section_b64_list)}: secciones de la página al hacer scroll.\n"
        user_text += "\nGenera la plantilla de extracción."
        if html_context:
            user_text += f"\n\nHTML de referencia para los selectores:\n{sanitize_html(html_context[:6000])}"

        if not is_openai:
            if not settings.ANTHROPIC_API_KEY:
                raise RuntimeError("ANTHROPIC_API_KEY no configurado")

            content_blocks: List[Dict[str, Any]] = [
                {"type": "text", "text": user_text},
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": rect_b64}},
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": full_b64}},
            ]
            for sec_b64 in section_b64_list:
                content_blocks.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": sec_b64}})

            ai_payload: Dict[str, Any] = {
                "model": model,
                "max_tokens": 2000,
                "temperature": 0.1,
                "system": system_msg,
                "messages": [{"role": "user", "content": content_blocks}],
            }
            headers = {
                "x-api-key": settings.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=ai_payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            raw_text = "".join(item.get("text", "") for item in data.get("content", []) if item.get("type") == "text")
        else:
            if not settings.OPENAI_API_KEY:
                raise RuntimeError("OPENAI_API_KEY no configurado")

            openai_content: List[Dict[str, Any]] = [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{rect_b64}"}},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{full_b64}"}},
            ]
            for sec_b64 in section_b64_list:
                openai_content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{sec_b64}"}})

            ai_payload = {
                "model": model,
                "max_tokens": 2000,
                "temperature": 0.1,
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": openai_content},
                ],
            }
            headers = {
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "content-type": "application/json",
            }
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post("https://api.openai.com/v1/chat/completions", json=ai_payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            raw_text = data["choices"][0]["message"]["content"]

        result = extract_json(raw_text)
        result["rect_screenshot"] = "data:image/jpeg;base64," + rect_b64
        result.setdefault("confidence", 0.8)
        result.setdefault("needs_hover", hover)
        return result

    async def capture_color_group(
        self,
        session_id: str,
        rects: List[Dict[str, Any]],
        context: str = "",
        hover: bool = False,
        ai_model: str = "",
    ) -> Dict[str, Any]:
        """Screenshot multiple same-color rects and analyze them together with AI vision."""
        session = self.get_session(session_id)
        page = self._active_page(session)

        if hover and rects:
            r = rects[0]
            await page.mouse.move((r["x1"] + r["x2"]) // 2, (r["y1"] + r["y2"]) // 2)
            await page.wait_for_timeout(700)

        # Screenshot each rect
        rect_b64_list: List[str] = []
        for r in rects:
            x1, y1, x2, y2 = int(r["x1"]), int(r["y1"]), int(r["x2"]), int(r["y2"])
            w, h = max(1, x2 - x1), max(1, y2 - y1)
            raw = await page.screenshot(
                type="jpeg", quality=88,
                clip={"x": x1, "y": y1, "width": w, "height": h},
            )
            rect_b64_list.append(base64.b64encode(raw).decode("utf-8"))

        # Full viewport screenshot
        full_raw = await page.screenshot(type="jpeg", quality=70)
        full_b64 = base64.b64encode(full_raw).decode("utf-8")

        # Additional section screenshots if no context
        section_b64_list: List[str] = []
        if not context.strip():
            try:
                page_height = await page.evaluate("document.body.scrollHeight")
                vp_height = session.viewport.get("height", 720)
                orig_scroll = int(await page.evaluate("window.pageYOffset"))
                positions = list(range(vp_height, min(int(page_height), vp_height * 4), vp_height))[:3]
                for pos in positions:
                    await page.evaluate(f"window.scrollTo(0, {pos})")
                    await page.wait_for_timeout(200)
                    sec_raw = await page.screenshot(type="jpeg", quality=55)
                    section_b64_list.append(base64.b64encode(sec_raw).decode("utf-8"))
                await page.evaluate(f"window.scrollTo(0, {orig_scroll})")
                await page.wait_for_timeout(150)
            except Exception as exc:
                logger.warning("Section screenshots failed: %s", exc)

        # HTML context from ALL rects (up to 3000 chars each)
        _html_js = """
        ({x1, y1, x2, y2}) => {
            const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
            let el = document.elementFromPoint(cx, cy);
            if (!el) return '';
            let candidate = el;
            while (candidate && candidate.parentElement && candidate.parentElement !== document.body) {
                const r = candidate.getBoundingClientRect();
                if (r.left <= x1 + 30 && r.top <= y1 + 30 && r.right >= x2 - 30 && r.bottom >= y2 - 30)
                    break;
                candidate = candidate.parentElement;
            }
            const parent = candidate.parentElement;
            return (parent ? parent.outerHTML : candidate.outerHTML).slice(0, 4000);
        }
        """
        html_parts: List[str] = []
        for idx, r in enumerate(rects):
            try:
                html = await page.evaluate(_html_js, {"x1": r["x1"], "y1": r["y1"], "x2": r["x2"], "y2": r["y2"]})
                if html:
                    hint = r.get("field_hint", "")
                    label = f"área {idx + 1}" + (f" («{hint}»)" if hint else "")
                    html_parts.append(f"--- HTML del {label} ---\n{sanitize_html(html)}")
            except Exception as exc:
                logger.warning("HTML context extraction failed for rect %d: %s", idx, exc)
        html_context = "\n\n".join(html_parts)

        model = ai_model or settings.ANTHROPIC_MODEL
        is_openai = model.lower().startswith(("gpt-", "o1-", "o3-", "o4-"))

        context_line = f"Contexto del usuario: «{context}»\n\n" if context.strip() else ""
        hover_line = "IMPORTANTE: El hover estaba ACTIVADO (el contenido puede haber sido revelado por CSS :hover).\n\n" if hover else ""

        n = len(rects)
        multi_line = (
            f"El usuario seleccionó {n} áreas DEL MISMO COLOR que están RELACIONADAS ENTRE SÍ.\n"
            "Analiza cómo interactúan (ej: selector/dropdown → renderiza imagen, acordeón → detalle, tabs → contenido).\n"
            "Para relaciones interactivas (control → resultado), el scraper debe: (1) leer todas las opciones del control, "
            "(2) por cada opción seleccionarla en el DOM y leer el resultado. Usa el HTML para confirmarlo.\n\n"
            if n > 1 else ""
        )

        system_msg = _SCRAPE_SYSTEM_MSG

        img_labels = "\n".join(
            f"Imagen {i + 1}: ÁREA {i + 1} de {n}"
            + (f" — el usuario describe: «{rects[i].get('field_hint', '')}»" if rects[i].get('field_hint') else "")
            + "."
            for i in range(n)
        )
        user_text = (
            f"{context_line}{hover_line}{multi_line}"
            f"{img_labels}\n"
            f"Imagen {n + 1}: PÁGINA COMPLETA (contexto visual).\n"
        )
        if section_b64_list:
            user_text += f"Imágenes {n + 2}-{n + 1 + len(section_b64_list)}: secciones al hacer scroll.\n"
        user_text += "\nGenera la plantilla de extracción."
        if html_context:
            user_text += f"\n\nHTML de referencia:\n{html_context[:8000]}"

        if not is_openai:
            if not settings.ANTHROPIC_API_KEY:
                raise RuntimeError("ANTHROPIC_API_KEY no configurado")

            content_blocks: List[Dict[str, Any]] = [{"type": "text", "text": user_text}]
            for rb64 in rect_b64_list:
                content_blocks.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": rb64}})
            content_blocks.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": full_b64}})
            for sb64 in section_b64_list:
                content_blocks.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": sb64}})

            ai_payload: Dict[str, Any] = {
                "model": model, "max_tokens": 2000, "temperature": 0.1,
                "system": system_msg,
                "messages": [{"role": "user", "content": content_blocks}],
            }
            headers = {
                "x-api-key": settings.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=ai_payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            raw_text = "".join(item.get("text", "") for item in data.get("content", []) if item.get("type") == "text")
        else:
            if not settings.OPENAI_API_KEY:
                raise RuntimeError("OPENAI_API_KEY no configurado")

            openai_content: List[Dict[str, Any]] = [{"type": "text", "text": user_text}]
            for rb64 in rect_b64_list:
                openai_content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{rb64}"}})
            openai_content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{full_b64}"}})
            for sb64 in section_b64_list:
                openai_content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{sb64}"}})

            ai_payload = {
                "model": model, "max_tokens": 2000, "temperature": 0.1,
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": openai_content},
                ],
            }
            headers = {
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "content-type": "application/json",
            }
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post("https://api.openai.com/v1/chat/completions", json=ai_payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            raw_text = data["choices"][0]["message"]["content"]

        result = extract_json(raw_text)
        if rect_b64_list:
            result["rect_screenshot"] = "data:image/jpeg;base64," + rect_b64_list[0]
        result.setdefault("confidence", 0.8)
        result.setdefault("needs_hover", hover)
        return result

    async def generate_ai_template(self, session_id: str) -> Dict[str, Any]:
        session = self.get_session(session_id)
        page = self._active_page(session)
        html_fragment = await page.evaluate(
            """
            () => {
                const candidates = Array.from(document.querySelectorAll("body *"))
                    .filter(el => el.children && el.children.length >= 3);
                let best = null;
                let bestScore = 0;
                for (const el of candidates) {
                    const children = Array.from(el.children);
                    if (children.length < 3) continue;
                    const tagCount = {};
                    children.forEach(child => { const key = child.tagName; tagCount[key] = (tagCount[key] || 0) + 1; });
                    const maxCount = Math.max(...Object.values(tagCount));
                    if (maxCount > bestScore) { bestScore = maxCount; best = el; }
                }
                return best ? best.innerHTML : document.body.innerHTML;
            }
            """,
        )

        sanitized = sanitize_html(html_fragment)
        if len(sanitized) > 30_000:
            sanitized = sanitized[:30_000]

        if not settings.ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY no configurado")

        payload = {
            "model": settings.ANTHROPIC_MODEL,
            "max_tokens": 1200,
            "temperature": 0.2,
            "system": (
                "Eres un experto en web scraping. Tu tarea es analizar un fragmento HTML "
                "de una página de listado inmobiliario e identificar los campos relevantes "
                "que se deben extraer de cada item/card.\n\n"
                "Devuelve ÚNICAMENTE un JSON con la siguiente estructura, sin explicaciones:\n"
                "{\n"
                '  "card_selector": "selector CSS del contenedor de cada item",\n'
                '  "fields": [\n'
                "    {\n"
                '      "name": "nombre_del_campo_en_snake_case",\n'
                '      "selector": "selector CSS relativo al card",\n'
                '      "type": "text|url|number|image",\n'
                '      "confidence": 0.0 a 1.0\n'
                "    }\n"
                "  ]\n"
                "}\n"
            ),
            "messages": [{"role": "user", "content": f"Contexto: página de listado de propiedades inmobiliarias.\nHTML:\n{sanitized}"}],
        }
        headers = {
            "x-api-key": settings.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        raw_text = ""
        for item in data.get("content", []):
            if item.get("type") == "text":
                raw_text += item.get("text", "")

        return extract_json(raw_text)


# ── Helpers ───────────────────────────────────────────────────────────────────

_ACCENT_MAP = str.maketrans("áéíóúàèìòùäëïöüñÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑ", "aeiouaeiouaeiounAEIOUAEIOUAEIOUN")

def _to_field_name(label: str) -> str:
    cleaned = label.translate(_ACCENT_MAP).lower()
    cleaned = re.sub(r"[^a-z0-9\s_]", "", cleaned)
    cleaned = re.sub(r"\s+", "_", cleaned.strip())
    return cleaned[:30] or "campo"


def sanitize_html(html: str) -> str:
    sanitized = re.sub(r"(?is)<(script|style|iframe|noscript)[^>]*>.*?</\1>", "", html)
    sanitized = re.sub(r"(?i)\son\w+\s*=\s*['\"][^'\"]*['\"]", "", sanitized)
    return sanitized


def extract_json(text: str) -> Dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("No se pudo extraer JSON de la respuesta de IA.")
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise ValueError("La respuesta de IA no contiene JSON válido.") from exc


visual_selector_manager = VisualSelectorManager()
