"""
Extract structured numeric fields (dormitorios, m2, baños) from free-text
property model descriptions.

Strategy:
  1. Regex — covers >90 % of cases, zero cost, instant.
  2. Claude Haiku fallback — only for the fields regex could not resolve.
"""

import re
import json
import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Regex patterns (ordered by specificity — first match wins per field)
# ---------------------------------------------------------------------------
_DORMITORIOS = [
    r'(\d+)\s*dorms?',
    r'(\d+)\s*dormitorios?',
    r'(\d+)\s*habitaciones?',
    r'(\d+)\s*hab\b',
    r'(\d+)\s*bedrooms?',
    r'(\d+)\s*br\b',
    r'(\d+)\s*cuartos?',
]

_M2 = [
    r'(\d+(?:[.,]\d+)?)\s*m\s*[²2²]\b',
    r'(\d+(?:[.,]\d+)?)\s*m2\b',
    r'(\d+(?:[.,]\d+)?)\s*metros?\s*cuadrados?',
    r'(\d+(?:[.,]\d+)?)\s*mts?\b',
]

_BAÑOS = [
    r'(\d+)\s*ba[ñn]os?',
    r'(\d+)\s*bathrooms?',
    r'(\d+)\s*wc\b',
    r'(\d+)\s*ss\.hh',
]


def _first_match(patterns: list[str], text: str) -> str | None:
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1).replace(',', '.')
    return None


def extract_with_regex(modelo: str) -> dict:
    return {
        k: v for k, v in {
            'dormitorios': _first_match(_DORMITORIOS, modelo),
            'm2':          _first_match(_M2, modelo),
            'baños':       _first_match(_BAÑOS, modelo),
        }.items() if v is not None
    }


def extract_with_ai(modelo: str, missing_fields: list[str]) -> dict:
    """Call Claude Haiku to resolve only the fields regex could not find."""
    try:
        import anthropic
        client = anthropic.Anthropic()
        fields_str = ', '.join(f'"{f}"' for f in missing_fields)
        response = client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=120,
            system=(
                'Eres un extractor de datos inmobiliarios. '
                'Responde ÚNICAMENTE con JSON válido, sin texto adicional.'
            ),
            messages=[{
                'role': 'user',
                'content': (
                    f'Extrae solo los campos {fields_str} de esta descripción de propiedad.\n'
                    f'Usa null si no puedes determinarlo con certeza.\n'
                    f'Formato: {{"dormitorios": <int|null>, "m2": <number|null>, "baños": <int|null>}}\n\n'
                    f'Descripción: "{modelo}"\n\n'
                    f'Ejemplos:\n'
                    f'  "TIPO 1 / 59 m2 / 1 dorms / 2 baños" → {{"dormitorios":1,"m2":59,"baños":2}}\n'
                    f'  "DUPLEX PENTHOUSE 150m2 esquina 3 habitaciones" → {{"dormitorios":3,"m2":150,"baños":null}}\n'
                    f'  "Studio 35m2 sin dormitorios" → {{"dormitorios":0,"m2":35,"baños":null}}\n'
                )
            }]
        )
        text = response.content[0].text.strip()
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            parsed = json.loads(match.group())
            return {k: str(v) for k, v in parsed.items() if v is not None and k in missing_fields}
    except Exception as exc:
        logger.warning('[field_extraction] AI fallback failed: %s', exc)
    return {}


def extract_fields(modelo: str | None) -> tuple[dict, str]:
    """
    Returns (fields, source) where source is 'regex' | 'ai' | 'none'.
    fields keys: dormitorios, m2, baños  (only populated keys are returned).
    """
    if not modelo or not modelo.strip():
        return {}, 'none'

    result = extract_with_regex(modelo)
    missing = [f for f in ('dormitorios', 'm2', 'baños') if f not in result]

    if not missing:
        return result, 'regex'

    ai_result = extract_with_ai(modelo, missing)
    result.update(ai_result)

    source = 'ai' if ai_result else 'regex'
    return result, source
