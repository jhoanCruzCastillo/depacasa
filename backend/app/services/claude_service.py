"""Claude AI integration for criteria extraction and conversation."""

import json
import re
import unicodedata
import logging
from config import settings


def _norm(s: str) -> str:
    """Lowercase + strip accent marks for accent-insensitive matching."""
    return ''.join(
        c for c in unicodedata.normalize('NFD', s.lower())
        if unicodedata.category(c) != 'Mn'
    )

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


def _digits_only(raw: str | None) -> str:
    return re.sub(r"\D", "", raw or "")


def _extract_labeled_value(text: str, labels: list[str]) -> str | None:
    if not text:
        return None
    label_group = "|".join(re.escape(l) for l in labels)
    m = re.search(
        rf"(?:^|[\n,;])\s*(?:{label_group})\s*[:\-]\s*([^\n,;]+)",
        text,
        re.IGNORECASE,
    )
    return m.group(1).strip() if m else None


def _normalize_document(raw: str | None) -> str | None:
    if not raw:
        return None
    token = re.sub(r"\s+", "", raw).upper()
    if not re.search(r"\d", token):
        return None
    if token.isdigit() and len(token) == 9:
        # Very likely a mobile number, not an identity document.
        return None
    if len(token) < 5 or len(token) > 20:
        return None
    return token


def _normalize_whatsapp(raw: str | None, document: str | None = None) -> str | None:
    if not raw:
        return None
    token = raw.strip()
    digits = _digits_only(token)
    if len(digits) < 9 or len(digits) > 15:
        return None
    if document and digits == _digits_only(document):
        return None
    return f"+{digits}" if token.startswith("+") else digits


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


def _fallback_contact_fields(raw: str) -> dict:
    text = (raw or "").strip()
    phone = _extract_labeled_value(
        text,
        ["whatsapp", "wsp", "ws", "telefono", "tel", "celular", "cel", "phone"],
    )
    phone = _normalize_whatsapp(phone)

    doc = _normalize_document(
        _extract_labeled_value(
            text,
            [
                "dni", "ce", "carnet", "carné", "doc", "documento", "pasaporte",
                "rut", "curp", "ine", "nie", "cedula", "cédula",
            ],
        )
    )
    if not doc:
        for m in re.finditer(r"\b[A-Za-z0-9\-]{5,20}\b", text):
            token = _normalize_document(m.group(0))
            if token:
                doc = token
                break

    if not phone:
        phone = _normalize_whatsapp(_fallback_phone(text), document=doc)

    name = None
    if text and not any(ch.isdigit() for ch in text):
        parts = [p for p in re.split(r"\s+", text) if p]
        if len(parts) >= 2:
            name = " ".join(w.capitalize() for w in parts[:6])

    return {
        "full_name": name,
        "whatsapp": phone,
        "document_number": doc,
    }


_CONTACT_SYSTEM = """\
Extrae datos de contacto desde un mensaje de chat inmobiliario.
Responde SOLO JSON valido (sin markdown) con este formato exacto:
{"full_name": "string o null", "whatsapp": "string o null", "document_number": "string o null"}

Reglas:
- full_name: nombre completo de persona si existe.
- whatsapp: telefono del usuario, limpio, con digitos y opcional '+'.
- document_number: documento de identidad si existe.
- Si el texto tiene etiquetas como "dni:", "documento:", "whatsapp:" o similares, respeta esas etiquetas.
- Nunca pongas un DNI/CURP/RUT/INE/Cedula en "whatsapp".
- Si un campo no aparece claramente, usa null.
- No inventes valores.
"""


async def extract_contact_fields(raw: str) -> dict:
    """Extract possible lead contact fields from a mixed free-text message."""
    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=200,
            system=_CONTACT_SYSTEM,
            messages=[{"role": "user", "content": raw}],
        )
        txt = response.content[0].text.strip()
        if txt.startswith("```"):
            txt = txt.split("```")[1]
            if txt.startswith("json"):
                txt = txt[4:]
        parsed = json.loads(txt.strip())
        full_name = parsed.get("full_name")
        document = _normalize_document(parsed.get("document_number"))
        whatsapp = _normalize_whatsapp(parsed.get("whatsapp"), document=document)
        return {
            "full_name": full_name,
            "whatsapp": whatsapp,
            "document_number": document,
        }
    except Exception as e:
        logger.warning(f"extract_contact_fields Claude error: {e} ??? using fallback")
        return _fallback_contact_fields(raw)


_CRITERIA_SYSTEM = """\
Eres un asistente inmobiliario experto. Extrae criterios de búsqueda de la \
descripción del usuario y responde SOLO con JSON válido, sin markdown ni texto extra.

Formato exacto (nunca omitas ninguna clave):
{"location": "string o null", "bedrooms": number o null, \
"min_price": number o null, "max_price": number o null, \
"features": ["lista de características"], \
"keywords": ["todas las palabras clave relevantes"]}

Reglas estrictas:
- "location": nombre oficial del distrito/ciudad/zona. Si el usuario menciona cualquier \
  lugar geográfico, incluso sin preposición, extráelo. Ejemplos: \
  "Jesús María" → "Jesús María", "miraflores" → "Miraflores", \
  "cajamarca" → "Cajamarca", "en Surco" → "Santiago de Surco".
- "bedrooms": número ENTERO de dormitorios. "una habitación"→1, "dos cuartos"→2, \
  "1 dorm"→1, "mono ambiente"→1. NUNCA confundas baños con dormitorios.
- "keywords": incluye sinónimos y variantes (ej. "departamento","depa","flat").
"""


def _merge_unique_terms(base: list[str], additions: list[str]) -> list[str]:
    seen = {_norm(x) for x in base if isinstance(x, str)}
    merged = [x for x in base if isinstance(x, str) and x.strip()]
    for term in additions:
        key = _norm(term)
        if key not in seen:
            merged.append(term)
            seen.add(key)
    return merged


def _enrich_criteria_semantics(criteria: dict, description: str) -> dict:
    """Infer implicit preferences from user language and enrich features/keywords."""
    out = dict(criteria or {})
    features = list(out.get("features") or [])
    keywords = list(out.get("keywords") or [])
    desc = _norm(description or "")

    exercise_signals = [
        "ejercicio", "ejercicios", "entrenar", "entrenamiento", "deporte",
        "actividad fisica", "fitness", "gym", "gimnasio", "correr", "running",
    ]
    if any(sig in desc for sig in exercise_signals):
        features = _merge_unique_terms(features, ["gimnasio", "área deportiva"])
        keywords = _merge_unique_terms(keywords, ["gimnasio", "gym", "área deportiva", "deporte"])

    out["features"] = features
    out["keywords"] = keywords
    return out


async def extract_criteria(description: str) -> dict:
    """Extract structured property criteria from a natural language description."""
    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=400,
            system=_CRITERIA_SYSTEM,
            messages=[{"role": "user", "content": description}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw.strip())
        return _enrich_criteria_semantics(parsed, description)
    except Exception as e:
        logger.warning(f"Criteria extraction failed: {e} — using regex fallback")
        return _enrich_criteria_semantics(_fallback_criteria(description), description)


async def rerank_properties(
    criteria: dict,
    description: str,
    candidates: list[tuple[str, dict]],
) -> list[str]:
    """Re-rank candidate properties by relevance using Claude.

    candidates: list of (record_id, data_dict).
    Returns record IDs in order from most to least relevant.
    """
    if len(candidates) <= 1:
        return [rid for rid, _ in candidates]

    # Build compact numbered summaries — child data + parent description excerpt
    lines: list[str] = []
    idx_to_id: dict[str, str] = {}
    for i, (rid, data) in enumerate(candidates, 1):
        parent_desc = data.pop("_parent_desc", "") if isinstance(data, dict) else ""
        child_summary = json.dumps(data, ensure_ascii=False)[:400].replace("\n", " ")
        parent_excerpt = f" | Proyecto: {parent_desc[:200]}" if parent_desc else ""
        lines.append(f"[{i}] {child_summary}{parent_excerpt}")
        idx_to_id[str(i)] = rid

    crit_parts: list[str] = []
    if criteria.get("location"):
        crit_parts.append(f"Ubicación: {criteria['location']}")
    if criteria.get("bedrooms"):
        crit_parts.append(f"Dormitorios: {criteria['bedrooms']}")
    if criteria.get("min_price") or criteria.get("max_price"):
        crit_parts.append(f"Precio: {criteria.get('min_price', '?')}–{criteria.get('max_price', '?')}")
    if criteria.get("features"):
        crit_parts.append(f"Características: {', '.join(criteria['features'])}")

    user_prompt = (
        f"El usuario busca:\n"
        + ("\n".join(crit_parts) or "(sin criterios específicos)")
        + (f"\nDescripción: {description}" if description else "")
        + "\n\nPropiedades candidatas:\n"
        + "\n".join(lines)
        + "\n\nOrdena los números de propiedades de más a menos relevante. "
        "Responde SOLO con los números separados por coma. Ejemplo: 3,1,4,2"
    )

    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=200,
            system=(
                "Eres un experto inmobiliario. Ordena propiedades por relevancia "
                "para el usuario. Responde ÚNICAMENTE con números separados por coma."
            ),
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = response.content[0].text.strip()
        indices = [p.strip() for p in raw.split(",") if p.strip().isdigit()]
        reranked = [idx_to_id[i] for i in indices if i in idx_to_id]
        # Append any IDs Claude omitted (preserve original scoring order)
        seen = set(reranked)
        for rid, _ in candidates:
            if rid not in seen:
                reranked.append(rid)
        return reranked
    except Exception as e:
        logger.warning(f"rerank_properties Claude error: {e}")
        return [rid for rid, _ in candidates]


_WORD_NUMS = {
    "un": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4,
    "cinco": 5, "seis": 6, "siete": 7, "ocho": 8,
}
_STOPWORDS = {
    "quiero", "busco", "necesito", "para", "como", "tiene", "tener",
    "con", "que", "una", "unos", "unas", "los", "las", "del", "por",
    "pero", "más", "este", "esta", "entre", "desde", "hasta", "sobre",
}


# Known Lima districts and major Peruvian cities for bare-name detection
_KNOWN_LOCATIONS = {
    # Lima districts
    "miraflores", "san isidro", "surco", "santiago de surco", "barranco",
    "la molina", "san borja", "jesús maría", "jesus maria", "magdalena",
    "lince", "pueblo libre", "san miguel", "breña", "lima", "callao",
    "chorrillos", "surquillo", "la victoria", "ate", "san juan de lurigancho",
    "san juan de miraflores", "villa el salvador", "villa maría del triunfo",
    "carabayllo", "comas", "independencia", "los olivos", "rímac", "rimac",
    "san martín de porres", "santa anita", "el agustino", "lurigancho",
    "lurín", "pachacámac", "chaclacayo", "cieneguilla", "punta hermosa",
    "san bartolo", "santa beatriz", "santa maría del mar", "pucusana",
    "punta negra", "ancón", "santa rosa",
    # Other major cities
    "cajamarca", "trujillo", "arequipa", "cusco", "piura", "iquitos",
    "chiclayo", "huancayo", "tacna", "ica", "puno", "chimbote",
}


def _fallback_criteria(description: str) -> dict:
    """Best-effort extraction when Claude is unavailable. Uses accent-normalized matching."""
    desc_norm = _norm(description)   # accent-free lowercase for matching
    desc_lower = description.lower()

    # Location — try preposition first, then bare known-location name.
    # Both original and normalized forms are compared.
    location: str | None = None
    loc_m = re.search(
        r'\b(?:en|de|para|sector|distrito|zona)\s+'
        r'([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+(?:de\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)',
        description,
    )
    if loc_m:
        location = loc_m.group(1).strip()
    else:
        for known in sorted(_KNOWN_LOCATIONS, key=len, reverse=True):
            known_norm = _norm(known)
            if re.search(r'\b' + re.escape(known_norm) + r'\b', desc_norm):
                location = known.title()
                break

    # Bedrooms — match against accent-normalized description so "habitación" → "habitacion"
    bedrooms: int | None = None
    bed_m = re.search(
        r'\b(\d+|' + '|'.join(_WORD_NUMS) + r')\s*'
        r'(?:dormitorio|habitacion|cuarto|dorm|bedroom|ambiente|recamara)',
        desc_norm,   # accent-free: "habitación" → "habitacion" ✓
    )
    if bed_m:
        raw = bed_m.group(1).lower()
        bedrooms = _WORD_NUMS.get(raw) or (int(raw) if raw.isdigit() else None)

    keywords = [
        w for w in re.findall(r'\b[a-z]{4,}\b', desc_norm)
        if w not in _STOPWORDS
    ]

    return {
        "location": location,
        "bedrooms": bedrooms,
        "min_price": None,
        "max_price": None,
        "features": [],
        "keywords": keywords,
    }
