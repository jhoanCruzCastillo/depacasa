from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from playwright.async_api import async_playwright, Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeoutError

from config import settings

logger = logging.getLogger(__name__)


@dataclass
class VisualSelectorSession:
    id: str
    context: BrowserContext
    page: Page
    created_at: datetime
    url: str
    viewport: Dict[str, int]


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

    async def create_session(self, url: str, viewport: Dict[str, int]) -> VisualSelectorSession:
        if not re.match(r"^https?://", url):
            raise ValueError("Solo se permiten URLs con protocolo http:// o https://")

        async with self._lock:
            if len(self._sessions) >= settings.MAX_BROWSER_SESSIONS:
                raise RuntimeError("Se alcanzó el máximo de sesiones activas")

            browser = await self._get_browser()
            context = await browser.new_context(
                viewport=viewport,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            page = await context.new_page()
            page.set_default_timeout(30_000)

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
                # Esperar load state sin bloquear si hay recursos lentos
                try:
                    await page.wait_for_load_state("load", timeout=8_000)
                except PlaywrightTimeoutError:
                    pass  # Continuar aunque no carguen todos los recursos
            except PlaywrightTimeoutError as exc:
                await context.close()
                raise RuntimeError("Tiempo de carga excedido (30s). Revisa la URL.") from exc

            # Scroll para activar lazy loading
            try:
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(1500)
            except Exception:
                pass  # No crítico

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
        return session

    async def close_session(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if not session:
            return
        await session.context.close()

    async def scroll_to(self, session_id: str, scroll_y: int) -> str:
        session = self.get_session(session_id)
        await session.page.evaluate(f"window.scrollTo({{top: {max(0, scroll_y)}, behavior: 'instant'}})")
        await session.page.wait_for_timeout(50)  # 50ms es suficiente para repintar
        return await self.screenshot(session_id)

    async def screenshot(self, session_id: str, quality: int = 72) -> str:
        session = self.get_session(session_id)
        raw = await session.page.screenshot(type="jpeg", quality=quality)
        return "data:image/jpeg;base64," + base64.b64encode(raw).decode("utf-8")

    async def free_click(self, session_id: str, x: int, y: int) -> str:
        """Clic real en la página (para aceptar cookies, cerrar modales, etc.)"""
        session = self.get_session(session_id)
        await session.page.mouse.click(x, y)
        await session.page.wait_for_timeout(350)  # esperar reacción de la página
        return await self.screenshot(session_id)

    async def hover_at(self, session_id: str, x: int, y: int) -> None:
        session = self.get_session(session_id)
        await session.page.evaluate(
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
        payload = await session.page.evaluate(
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
            matches = await session.page.locator(payload["selector"]).count()
        except (PlaywrightTimeoutError, ValueError) as exc:
            logger.warning("Selector inválido o sin coincidencias: %s", exc)
            matches = 0

        payload["matches"] = matches
        return payload

    async def validate_selectors(
        self,
        session_id: str,
        card_selector: Optional[str],
        fields: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        session = self.get_session(session_id)
        result = await session.page.evaluate(
            """
            ({cardSelector, fields}) => {
                const output = {
                    card_count: 0,
                    results: [],
                    preview: [],
                };
                const normalize = (value) => (value || "").trim();
                const extractValue = (el, type) => {
                    if (!el) return null;
                    if (type === "url") {
                        const href = el.getAttribute("href");
                        return href ? href : null;
                    }
                    if (type === "image") {
                        const src = el.getAttribute("src");
                        return src ? src : null;
                    }
                    return normalize(el.innerText || el.textContent || "");
                };

                if (cardSelector) {
                    const cards = Array.from(document.querySelectorAll(cardSelector));
                    output.card_count = cards.length;
                    fields.forEach((field) => {
                        let found = 0;
                        let missing = 0;
                        cards.forEach((card) => {
                            const el = card.querySelector(field.selector);
                            const val = extractValue(el, field.type);
                            if (val) found += 1;
                            else missing += 1;
                        });
                        output.results.push({
                            name: field.name,
                            selector: field.selector,
                            found,
                            missing,
                            total: cards.length,
                        });
                    });

                    output.preview = cards.slice(0, 3).map((card) => {
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
                    output.results.push({
                        name: field.name,
                        selector: field.selector,
                        found: elements.length,
                        missing: 0,
                        total: elements.length,
                    });
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

    async def generate_ai_template(self, session_id: str) -> Dict[str, Any]:
        session = self.get_session(session_id)
        html_fragment = await session.page.evaluate(
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
                    children.forEach(child => {
                        const key = child.tagName;
                        tagCount[key] = (tagCount[key] || 0) + 1;
                    });
                    const maxCount = Math.max(...Object.values(tagCount));
                    if (maxCount > bestScore) {
                        bestScore = maxCount;
                        best = el;
                    }
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
            "messages": [
                {
                    "role": "user",
                    "content": f"Contexto: página de listado de propiedades inmobiliarias.\nHTML:\n{sanitized}",
                }
            ],
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

        extracted = extract_json(raw_text)
        return extracted


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
