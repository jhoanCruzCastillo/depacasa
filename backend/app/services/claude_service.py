"""Claude AI integration for criteria extraction and conversation."""

import json
import re
import logging
from config import settings

logger = logging.getLogger(__name__)
_client = None


def _get_client():
    global _client
    if _client is None:
        from anthropic import Anthropic
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


# ── Regex-based fallbacks (used when Claude is unavailable) ────────────────────

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

_NAME_STRIP = re.compile(
    r"^\s*(soy|me llamo|mi nombre es|me dicen|pueden llamarme|llámame|soy el|soy la|hola soy|hola me llamo)\s+",
    re.IGNORECASE,
)

_COUNTRIES = [
    "perú", "peru", "colombia", "méxico", "mexico", "chile", "argentina",
    "ecuador", "bolivia", "venezuela", "brasil", "brazil", "paraguay",
    "uruguay", "panamá", "panama", "costa rica", "guatemala", "honduras",
    "nicaragua", "el salvador", "cuba", "república dominicana", "españa",
    "estados unidos", "usa",
]

_PHONE_RE = re.compile(r"[\+]?[\d][\d\s\-\(\)\.]{6,17}[\d]")


def _fallback_email(raw: str) -> str:
    m = _EMAIL_RE.search(raw)
    return m.group().lower() if m else raw.strip().lower()


def _fallback_name(raw: str) -> str:
    cleaned = _NAME_STRIP.sub("", raw.strip())
    words = cleaned.split()[:3]
    return " ".join(w.capitalize() for w in words if w) or raw.strip()


def _fallback_country(raw: str) -> str:
    lower = raw.lower()
    for c in _COUNTRIES:
        if c in lower:
            return c.title().replace("Ee.Uu.", "EE.UU.")
    return raw.strip().title()


def _fallback_phone(raw: str) -> str:
    m = _PHONE_RE.search(raw)
    if m:
        return re.sub(r"[\s\-\(\)\.]", "", m.group())
    return raw.strip()


_FALLBACKS = {0: _fallback_email, 1: _fallback_name, 2: _fallback_country, 3: _fallback_phone}


# ── Public API ─────────────────────────────────────────────────────────────────

async def extract_user_field(step: int, raw: str) -> str:
    """Extract a specific user info field from natural language.

    Tries Claude first; falls back to regex when the API is unavailable.
    Steps: 0=email, 1=name, 2=country, 3=phone
    """
    instructions = {
        0: (
            "Extrae SOLO el correo electrónico del texto dado. "
            "Responde únicamente con el correo en minúsculas. Sin saludos ni explicaciones. "
            "Ejemplos: 'mi correo es juan@gmail.com' → juan@gmail.com | 'soy antonio@hotmail.com' → antonio@hotmail.com"
        ),
        1: (
            "Extrae SOLO el nombre propio de la persona del texto dado. "
            "Responde únicamente con el nombre (puede ser compuesto). Sin saludos ni explicaciones. "
            "Ejemplos: 'soy Jhoan' → Jhoan | 'me llamo María García' → María García"
        ),
        2: (
            "Extrae SOLO el nombre del país del texto dado. "
            "Responde únicamente con el nombre del país en español. "
            "Ejemplos: 'soy de Perú' → Perú | 'soy peruano' → Perú | 'vivo en Colombia' → Colombia"
        ),
        3: (
            "Extrae SOLO el número de teléfono del texto dado, con código de país si existe. "
            "Responde únicamente con el número limpio. "
            "Ejemplos: 'mi número es +51 980 490 696' → +51980490696 | '980 490 696' → 980490696"
        ),
    }
    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=60,
            system=instructions[step],
            messages=[{"role": "user", "content": raw}],
        )
        extracted = response.content[0].text.strip()
        return extracted if extracted else _FALLBACKS[step](raw)
    except Exception as e:
        logger.warning(f"extract_user_field step={step} Claude error: {e} — using regex fallback")
        return _FALLBACKS[step](raw)


async def extract_criteria(description: str) -> dict:
    """Extract structured property criteria from a natural language description."""
    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=400,
            system=(
                "Eres un asistente inmobiliario. Extrae criterios de búsqueda "
                "de la descripción del usuario. Responde SOLO con JSON válido, sin markdown ni texto extra. "
                'Formato exacto: {"location": "string o null", "bedrooms": number o null, '
                '"min_price": number o null, "max_price": number o null, '
                '"features": ["lista", "de", "caracteristicas"], '
                '"keywords": ["todas", "las", "palabras", "clave", "relevantes"]}'
            ),
            messages=[{"role": "user", "content": description}],
        )
        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())
    except Exception as e:
        logger.warning(f"Criteria extraction failed: {e}")
        words = [w for w in description.lower().split() if len(w) > 3]
        return {
            "location": None,
            "bedrooms": None,
            "min_price": None,
            "max_price": None,
            "features": [],
            "keywords": words,
        }
