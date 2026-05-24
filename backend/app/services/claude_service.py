"""Claude AI integration for criteria extraction and conversation."""

import json
import re
import unicodedata
import logging
from config import settings
from app.services.chatbot_intents.types import (
    AJUSTAR_CRITERIOS_BUSQUEDA,
    CALIFICAR_PROPIEDAD,
    CAPTURAR_DATOS_CONTACTO,
    CAPTURAR_SUSTENTO_FINANCIERO,
    CONFIRMAR_RELAJACION_RESULTADOS,
    CONSULTAR_DETALLE_PROPIEDAD_ACTUAL,
    CONTINUAR_CON_CONTEXTO,
    FALLBACK_FUERA_DE_ALCANCE,
    FALLBACK_NO_ENTENDIDO,
    INICIO_BUSQUEDA,
    MARCAR_INTERES_LO_QUIERO,
    VER_PROPIEDADES_NUEVAS_NO_VISTAS,
    VER_PROPIEDADES_VISTAS,
    VER_SIGUIENTE_PROPIEDAD,
)


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


# â”€â”€ Regex-based fallbacks (used when Claude is unavailable) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

_NAME_STRIP = re.compile(
    r"^\s*(soy|me llamo|mi nombre es|me dicen|pueden llamarme|llÃ¡mame|soy el|soy la|hola soy|hola me llamo)\s+",
    re.IGNORECASE,
)

_COUNTRIES = [
    "perÃº", "peru", "colombia", "mÃ©xico", "mexico", "chile", "argentina",
    "ecuador", "bolivia", "venezuela", "brasil", "brazil", "paraguay",
    "uruguay", "panamÃ¡", "panama", "costa rica", "guatemala", "honduras",
    "nicaragua", "el salvador", "cuba", "repÃºblica dominicana", "espaÃ±a",
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


# â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def extract_user_field(step: int, raw: str) -> str:
    """Extract a specific user info field from natural language.

    Tries Claude first; falls back to regex when the API is unavailable.
    Steps: 0=email, 1=name, 2=country, 3=phone
    """
    instructions = {
        0: (
            "Extrae SOLO el correo electrÃ³nico del texto dado. "
            "Responde Ãºnicamente con el correo en minÃºsculas. Sin saludos ni explicaciones. "
            "Ejemplos: 'mi correo es juan@gmail.com' â†’ juan@gmail.com | 'soy antonio@hotmail.com' â†’ antonio@hotmail.com"
        ),
        1: (
            "Extrae SOLO el nombre propio de la persona del texto dado. "
            "Responde Ãºnicamente con el nombre (puede ser compuesto). Sin saludos ni explicaciones. "
            "Ejemplos: 'soy Jhoan' â†’ Jhoan | 'me llamo MarÃ­a GarcÃ­a' â†’ MarÃ­a GarcÃ­a"
        ),
        2: (
            "Extrae SOLO el nombre del paÃ­s del texto dado. "
            "Responde Ãºnicamente con el nombre del paÃ­s en espaÃ±ol. "
            "Ejemplos: 'soy de PerÃº' â†’ PerÃº | 'soy peruano' â†’ PerÃº | 'vivo en Colombia' â†’ Colombia"
        ),
        3: (
            "Extrae SOLO el nÃºmero de telÃ©fono del texto dado, con cÃ³digo de paÃ­s si existe. "
            "Responde Ãºnicamente con el nÃºmero limpio. "
            "Ejemplos: 'mi nÃºmero es +51 980 490 696' â†’ +51980490696 | '980 490 696' â†’ 980490696"
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
        logger.warning(f"extract_user_field step={step} Claude error: {e} â€” using regex fallback")
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
                "dni", "ce", "carnet", "carnÃ©", "doc", "documento", "pasaporte",
                "rut", "curp", "ine", "nie", "cedula", "cÃ©dula",
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


def _sanitize_quick_replies(options: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in options:
        if not isinstance(raw, str):
            continue
        opt = " ".join(raw.strip().split())
        if not opt:
            continue
        if len(opt) > 64:
            opt = opt[:64].rstrip()
        key = _norm(opt)
        if key in seen:
            continue
        seen.add(key)
        out.append(opt)
        if len(out) >= 4:
            break
    return out


def _fallback_quick_replies(
    assistant_message: str,
    state: str,
    has_card: bool,
    has_saved_criteria: bool,
) -> list[str]:
    msg = _norm(assistant_message or "")
    st = (state or "").strip().lower()

    if has_card:
        return ["Ver siguiente", "Lo quiero", "Ajustar criterios"]

    if "solo me falta" in msg or "aun me faltan" in msg:
        return ["Te comparto mis datos", "Prefiero continuar buscando"]

    if "ya viste todas" in msg:
        return ["Ajustar criterios", "Ver propiedades vistas"]

    if st == "contact_requested":
        return ["Ver opciones nuevas", "Ver propiedades vistas"]

    if has_saved_criteria:
        return ["Iniciar busqueda ahora", "Ver novedades", "Ajustar criterios"]
    return ["Si, busca propiedades", "No por ahora", "Ajustar criterios"]


_QUICK_REPLIES_SYSTEM = """\
Genera opciones de respuesta rapida para un chatbot inmobiliario en espanol.
Responde SOLO JSON valido sin markdown con este formato:
{"options": ["opcion 1", "opcion 2", "opcion 3"]}

Reglas:
- Entre 2 y 4 opciones cortas (max 50 caracteres), accionables y clickeables.
- Deben encajar con el ultimo mensaje del asistente y el estado conversacional.
- No inventes datos.

USA EXACTAMENTE estas frases cuando correspondan (el sistema las detecta por texto exacto):
  PARA BUSCAR NUEVAS/NO VISTAS: "Ver novedades" | "Ver opciones nuevas" | "Ver propiedades nuevas"
  PARA CONFIRMAR/BUSCAR CON PREFERENCIAS: "Iniciar busqueda ahora" | "Usar preferencias actuales" | "Si, busca propiedades"
  PARA VER YA VISTAS: "Ver propiedades vistas" | "Propiedades que ya vi"
  PARA AJUSTAR: "Ajustar criterios" | "Ajustar preferencias" | "Cambiar criterios"
  PARA SIGUIENTE PROPIEDAD: "Ver siguiente"
  PARA MARCAR INTERES: "Lo quiero"
  PARA NEGAR: "No por ahora" | "Prefiero no"

Acciones PROHIBIDAS — NO sugieras NUNCA:
  - "Guardar esta propiedad" ni ninguna variante de guardar/favoritos/lista de deseos.
  - Compartir la propiedad, enviar por email, exportar.
  - Cualquier accion que no este en la lista de disponibles.
"""


async def generate_quick_replies(
    assistant_message: str,
    state: str,
    has_card: bool = False,
    user_message: str = "",
    has_saved_criteria: bool = False,
) -> list[str]:
    fallback = _fallback_quick_replies(
        assistant_message=assistant_message,
        state=state,
        has_card=has_card,
        has_saved_criteria=has_saved_criteria,
    )
    try:
        payload = {
            "assistant_message": assistant_message,
            "state": state,
            "has_card": has_card,
            "user_message": user_message,
            "has_saved_criteria": has_saved_criteria,
        }
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=220,
            system=_QUICK_REPLIES_SYSTEM,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
        txt = response.content[0].text.strip()
        if txt.startswith("```"):
            txt = txt.split("```")[1]
            if txt.startswith("json"):
                txt = txt[4:]
        parsed = json.loads(txt.strip())
        options = _sanitize_quick_replies(list(parsed.get("options") or []))
        return options or fallback
    except Exception as e:
        logger.warning(f"generate_quick_replies Claude error: {e} â€” using fallback")
        return fallback



_INTENT_RANKING_SYSTEM = """\
Eres un clasificador de intenciones para un chatbot inmobiliario.
Responde SOLO JSON valido, sin markdown, con este formato exacto:
{"ordered_intents": ["intent_1", "intent_2"]}

Reglas:
- Usa SOLO intenciones incluidas en "candidates".
- Manten el orden de ejecucion real si el mensaje contiene varias acciones.
- No inventes intenciones nuevas.
- SIEMPRE devuelve al menos una intencion.
- Mensajes sociales/saludos/charla informal ("hola", "gracias", "como estas", etc.):
  devuelve ["fallback_no_entendido"] si esta en candidates.
- Mensajes completamente fuera del dominio inmobiliario (politica, chistes, etc.):
  devuelve ["fallback_fuera_de_alcance"] si esta en candidates, si no ["fallback_no_entendido"].
- Si el mensaje combina una accion real con charla, prioriza la accion real.
"""


def _first_match_position(text: str, patterns: list[str]) -> int | None:
    best: int | None = None
    for token in patterns:
        pos = text.find(token)
        if pos >= 0 and (best is None or pos < best):
            best = pos
    return best


def _looks_in_scope_message(norm_text: str) -> bool:
    hints = [
        "propiedad", "propiedades", "departamento", "depa", "casa",
        "zona", "ubicacion", "distrito", "dormitorio", "habitacion", "cuarto",
        "precio", "presupuesto", "bano", "metros", "m2",
        "siguiente", "otra", "ver", "calificar", "estrellas",
        "lo quiero", "interesa", "asesor", "contacto", "whatsapp",
    ]
    return any(h in norm_text for h in hints)


def _fallback_rank_intents(message: str, candidates: list[str]) -> list[str]:
    norm_msg = _norm(message or "")
    triggers = {
        CALIFICAR_PROPIEDAD: ["estrella", "califico", "calificar", "puntuo", "rating"],
        VER_SIGUIENTE_PROPIEDAD: ["siguiente", "otra", "ver otra", "next", "skip", "no me convence"],
        MARCAR_INTERES_LO_QUIERO: ["lo quiero", "me interesa", "contactar", "asesor", "me gusta"],
        AJUSTAR_CRITERIOS_BUSQUEDA: ["ajust", "filtro", "cambiar", "modificar", "otra zona", "nueva busqueda"],
        VER_PROPIEDADES_NUEVAS_NO_VISTAS: ["no vistas", "nuevas", "aun no he visto", "sin ver"],
        VER_PROPIEDADES_VISTAS: ["vistas", "anteriores", "ya revisaste", "interesan"],
        CONFIRMAR_RELAJACION_RESULTADOS: ["si", "sí", "dale", "ok", "mostrar", "verlas", "no", "prefiero no"],
        CONTINUAR_CON_CONTEXTO: ["si", "sí", "adelante", "continuar", "usa mis preferencias"],
        CAPTURAR_DATOS_CONTACTO: ["whatsapp", "dni", "documento", "me llamo", "soy de", "telefono", "celular"],
        CAPTURAR_SUSTENTO_FINANCIERO: [
            "sustento financiero",
            "capacidad financiera",
            "preaprobacion",
            "pre aprobacion",
            "aprobacion bancaria",
            "estado de cuenta",
            "adjunto pdf",
            "enlace",
            "link",
            "drive",
        ],
        CONSULTAR_DETALLE_PROPIEDAD_ACTUAL: ["detalle", "detalles", "mas info", "informacion", "precio", "m2", "metros"],
        INICIO_BUSQUEDA: ["busco", "quiero", "necesito", "departamento", "casa", "dormitorio", "zona", "presupuesto"],
    }

    scored: list[tuple[int, int, str]] = []
    for idx, intent in enumerate(candidates):
        patterns = triggers.get(intent)
        if not patterns:
            continue
        pos = _first_match_position(norm_msg, patterns)
        if pos is None:
            continue
        scored.append((pos, idx, intent))

    scored.sort(key=lambda item: (item[0], item[1]))
    ordered = [intent for _, _, intent in scored]

    if not ordered:
        result: list[str] = []
        if FALLBACK_FUERA_DE_ALCANCE in candidates and not _looks_in_scope_message(norm_msg):
            result.append(FALLBACK_FUERA_DE_ALCANCE)
        if FALLBACK_NO_ENTENDIDO in candidates:
            result.append(FALLBACK_NO_ENTENDIDO)
        return result or list(candidates)

    if FALLBACK_FUERA_DE_ALCANCE in candidates and not _looks_in_scope_message(norm_msg):
        ordered.insert(0, FALLBACK_FUERA_DE_ALCANCE)
    if FALLBACK_NO_ENTENDIDO in candidates:
        ordered.append(FALLBACK_NO_ENTENDIDO)

    deduped: list[str] = []
    seen: set[str] = set()
    for intent in ordered:
        if intent in seen:
            continue
        if intent not in candidates:
            continue
        seen.add(intent)
        deduped.append(intent)
    return deduped


async def rank_intents(
    message: str,
    candidates: list[str],
    state: str,
    step: int | None = None,
) -> list[str]:
    fallback = _fallback_rank_intents(message, candidates)
    if not candidates:
        return []
    try:
        payload = {
            "message": message,
            "state": state,
            "step": step,
            "candidates": candidates,
        }
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=240,
            system=_INTENT_RANKING_SYSTEM,
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
        txt = response.content[0].text.strip()
        if txt.startswith("```"):
            txt = txt.split("```")[1]
            if txt.startswith("json"):
                txt = txt[4:]
        parsed = json.loads(txt.strip())
        ordered = [str(x) for x in list(parsed.get("ordered_intents") or []) if isinstance(x, str)]
        filtered: list[str] = []
        seen: set[str] = set()
        for intent in ordered:
            if intent not in candidates or intent in seen:
                continue
            seen.add(intent)
            filtered.append(intent)
        return filtered or fallback
    except Exception as e:
        logger.warning(f"rank_intents Claude error: {e} â€” using fallback")
        return fallback

_CRITERIA_SYSTEM = """\
Eres un asistente inmobiliario experto. Extrae criterios de busqueda de la descripcion \
del usuario y responde SOLO con JSON valido, sin markdown ni texto extra.

Formato exacto (incluye siempre todas las claves):
{"location": "string o null", "location_mode": "obligatorio|preferencia",
 "bedrooms": number o null, "bedrooms_mode": "obligatorio|preferencia",
 "bathrooms": number o null, "bathrooms_mode": "obligatorio|preferencia",
 "min_price": number o null, "max_price": number o null, "budget_mode": "obligatorio|preferencia",
 "common_areas": ["amenidades dentro del edificio"], "common_areas_mode": "obligatorio|preferencia",
 "nearby_zones": ["tipos de lugares cercanos requeridos"], "nearby_zones_mode": "obligatorio|preferencia",
 "features": ["caracteristicas generales"], "keywords": ["palabras clave relevantes"]}

Reglas de extraccion:
- "location": nombre oficial del distrito/ciudad/zona. Ej: "Jesus Maria", "Miraflores", "Santiago de Surco".
- "bedrooms": entero de dormitorios. "una habitacion"->1, "dos cuartos"->2. NUNCA confundas banos con dormitorios.
- "bathrooms": entero de banos si se menciona. null si no.
- "min_price"/"max_price": numeros sin simbolo de moneda.
- "common_areas": amenidades dentro del edificio/complejo mencionadas. Ej: \
  "quiero gimnasio" -> ["gimnasio"]; "tiene piscina" -> ["piscina"]; \
  "salon de eventos y terraza" -> ["salon comunal", "terraza"].
- "nearby_zones": lugares cercanos requeridos. Ej: "cerca de un parque" -> ["parque"]; \
  "que haya supermercados" -> ["supermercado"]; "proximos a colegios" -> ["colegio"].

Reglas de modo (obligatorio vs preferencia):
- Usa "obligatorio" cuando el usuario dice: "necesito", "debe tener", "tiene que ser", \
  "es imprescindible", "exactamente", "no puedo pasar de", "solo en", "unicamente".
- Usa "preferencia" en todos los demas casos (es el valor por defecto).
"""


# Vocabulary catalog for semantic area enrichment (fallback when Claude doesn't extract them)
_AREA_SIGNALS: dict[str, dict[str, list[str]]] = {
    "comunes": {
        "gimnasio": ["ejercicio", "ejercicios", "entrenar", "entrenamiento", "deporte",
                     "actividad fisica", "fitness", "gym", "gimnasio", "correr", "running"],
        "piscina": ["piscina", "nadar", "pileta", "natacion", "alberca", "nado"],
        "salon comunal": ["salon comunal", "salon de eventos", "sala de usos", "reuniones",
                          "fiestas", "evento social"],
        "area de juegos": ["juegos infantiles", "juegos para ninos", "parque infantil",
                           "playground", "zona de ninos"],
        "terraza": ["terraza", "rooftop", "azotea", "vista panoramica"],
        "parrilla": ["parrilla", "bbq", "asado", "barbacoa", "area de parrillas"],
        "coworking": ["coworking", "trabajo remoto", "home office", "oficina compartida"],
        "estacionamiento": ["garage", "estacionamiento", "parking", "cochera",
                            "lugar de estacionamiento"],
    },
    "cercanas": {
        "supermercado": ["viveres", "viveres", "compras del hogar", "supermercado",
                         "mercado", "bodega", "tienda de abarrotes"],
        "colegio": ["colegio", "escuela", "cerca de colegios", "educacion",
                    "zona escolar", "colegios proximos"],
        "hospital": ["hospital", "clinica", "medico", "salud", "emergencias",
                     "centro medico"],
        "transporte publico": ["metro", "bus", "transporte publico", "paradero",
                               "estacion de bus", "movilidad"],
        "parque": ["parque", "areas verdes", "espacio verde", "zona verde",
                   "parque cercano"],
        "restaurante": ["restaurante", "cafeteria", "gastronomia", "zona de restaurantes",
                        "lugares para comer"],
        "centro comercial": ["mall", "centro comercial", "tiendas", "shopping",
                             "plaza comercial"],
    },
}


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
    """Infer implicit area preferences from user language using vocabulary signals.

    Runs after Claude extraction to catch anything missed and normalize terms.
    common_areas/nearby_zones extracted by Claude are kept; vocabulary signals only add
    new entries that aren't already present.
    """
    out = dict(criteria or {})
    features = list(out.get("features") or [])
    keywords = list(out.get("keywords") or [])
    common_areas = list(out.get("common_areas") or [])
    nearby_zones = list(out.get("nearby_zones") or [])
    desc = _norm(description or "")

    existing_comunes = {_norm(a) for a in common_areas}
    existing_cercanas = {_norm(z) for z in nearby_zones}

    def _signal_match(sig: str, text: str) -> bool:
        return bool(re.search(r'\b' + re.escape(sig) + r'\b', text))

    for area_name, signals in _AREA_SIGNALS["comunes"].items():
        if any(_signal_match(sig, desc) for sig in signals):
            norm_name = _norm(area_name)
            if norm_name not in existing_comunes:
                common_areas.append(area_name)
                existing_comunes.add(norm_name)
            features = _merge_unique_terms(features, [area_name])
            keywords = _merge_unique_terms(keywords, [area_name])

    for zone_name, signals in _AREA_SIGNALS["cercanas"].items():
        if any(_signal_match(sig, desc) for sig in signals):
            norm_name = _norm(zone_name)
            if norm_name not in existing_cercanas:
                nearby_zones.append(zone_name)
                existing_cercanas.add(norm_name)
            keywords = _merge_unique_terms(keywords, [zone_name])

    # Also add common_areas and nearby_zones already extracted by Claude to features/keywords
    for area in common_areas:
        features = _merge_unique_terms(features, [area])
        keywords = _merge_unique_terms(keywords, [area])
    for zone in nearby_zones:
        keywords = _merge_unique_terms(keywords, [zone])

    out["features"] = features
    out["keywords"] = keywords
    out["common_areas"] = common_areas
    out["nearby_zones"] = nearby_zones
    return out


async def extract_criteria(description: str) -> dict:
    """Extract structured property criteria from a natural language description."""
    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=600,
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
        logger.warning(f"Criteria extraction failed: {e} â€” using regex fallback")
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

    # Build compact numbered summaries â€” child data + parent description excerpt
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
        crit_parts.append(f"UbicaciÃ³n: {criteria['location']}")
    if criteria.get("bedrooms"):
        crit_parts.append(f"Dormitorios: {criteria['bedrooms']}")
    if criteria.get("min_price") or criteria.get("max_price"):
        crit_parts.append(f"Precio: {criteria.get('min_price', '?')}â€“{criteria.get('max_price', '?')}")
    if criteria.get("features"):
        crit_parts.append(f"CaracterÃ­sticas: {', '.join(criteria['features'])}")

    user_prompt = (
        f"El usuario busca:\n"
        + ("\n".join(crit_parts) or "(sin criterios especÃ­ficos)")
        + (f"\nDescripciÃ³n: {description}" if description else "")
        + "\n\nPropiedades candidatas:\n"
        + "\n".join(lines)
        + "\n\nOrdena los nÃºmeros de propiedades de mÃ¡s a menos relevante. "
        "Responde SOLO con los nÃºmeros separados por coma. Ejemplo: 3,1,4,2"
    )

    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=200,
            system=(
                "Eres un experto inmobiliario. Ordena propiedades por relevancia "
                "para el usuario. Responde ÃšNICAMENTE con nÃºmeros separados por coma."
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
    "pero", "mÃ¡s", "este", "esta", "entre", "desde", "hasta", "sobre",
}


# Known Lima districts and major Peruvian cities for bare-name detection
_KNOWN_LOCATIONS = {
    # Lima districts
    "miraflores", "san isidro", "surco", "santiago de surco", "barranco",
    "la molina", "san borja", "jesÃºs marÃ­a", "jesus maria", "magdalena",
    "lince", "pueblo libre", "san miguel", "breÃ±a", "lima", "callao",
    "chorrillos", "surquillo", "la victoria", "ate", "san juan de lurigancho",
    "san juan de miraflores", "villa el salvador", "villa marÃ­a del triunfo",
    "carabayllo", "comas", "independencia", "los olivos", "rÃ­mac", "rimac",
    "san martÃ­n de porres", "santa anita", "el agustino", "lurigancho",
    "lurÃ­n", "pachacÃ¡mac", "chaclacayo", "cieneguilla", "punta hermosa",
    "san bartolo", "santa beatriz", "santa marÃ­a del mar", "pucusana",
    "punta negra", "ancÃ³n", "santa rosa",
    # Other major cities
    "cajamarca", "trujillo", "arequipa", "cusco", "piura", "iquitos",
    "chiclayo", "huancayo", "tacna", "ica", "puno", "chimbote",
}


def _fallback_criteria(description: str) -> dict:
    """Best-effort extraction when Claude is unavailable. Uses accent-normalized matching."""
    desc_norm = _norm(description)   # accent-free lowercase for matching
    desc_lower = description.lower()

    # Location â€” try preposition first, then bare known-location name.
    # Both original and normalized forms are compared.
    location: str | None = None
    loc_m = re.search(
        r'\b(?:en|de|para|sector|distrito|zona)\s+'
        r'([A-ZÃÃ‰ÃÃ“ÃšÃ‘][a-zÃ¡Ã©Ã­Ã³ÃºÃ±]+(?:\s+(?:de\s+)?[A-ZÃÃ‰ÃÃ“ÃšÃ‘][a-zÃ¡Ã©Ã­Ã³ÃºÃ±]+)?)',
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

    # Bedrooms â€” match against accent-normalized description so "habitaciÃ³n" â†’ "habitacion"
    bedrooms: int | None = None
    bed_m = re.search(
        r'\b(\d+|' + '|'.join(_WORD_NUMS) + r')\s*'
        r'(?:dormitorio|habitacion|cuarto|dorm|bedroom|ambiente|recamara)',
        desc_norm,   # accent-free: "habitaciÃ³n" â†’ "habitacion" âœ“
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
        "location_mode": "preferencia",
        "bedrooms": bedrooms,
        "bedrooms_mode": "preferencia",
        "bathrooms": None,
        "bathrooms_mode": "preferencia",
        "min_price": None,
        "max_price": None,
        "budget_mode": "preferencia",
        "common_areas": [],
        "common_areas_mode": "preferencia",
        "nearby_zones": [],
        "nearby_zones_mode": "preferencia",
        "features": [],
        "keywords": keywords,
    }


# ── Rating feedback criteria extraction ──────────────────────────────────────

_RATING_FEEDBACK_SYSTEM = """\
Eres un asistente inmobiliario. El usuario acabo de calificar una propiedad y dio un comentario.
Analiza el feedback y extrae AJUSTES de busqueda concretos.
Responde SOLO JSON valido (sin markdown) con este formato exacto:
{"location": null, "bedrooms": null,
 "area_min": null, "area_max": null,
 "min_price": null, "max_price": null,
 "common_areas": [], "nearby_zones": [], "keywords": []}

Reglas por tipo de comentario negativo (baja calificacion):
- "muy pequeno/chico/reducido" + propiedad tiene Xm2 -> area_min = X + 15
- "muy caro/precio alto/fuera de presupuesto/muy costoso" + precio Y -> max_price = Y * 0.85
- "muchos dormitorios/cuartos/habitaciones" -> no cambiar o reducir bedrooms
- "pocos dormitorios" + tiene N -> bedrooms = N + 1
- "no tiene [amenidad]" o "le falta [amenidad]" -> agregar a common_areas
- "lejos de [lugar]" o "no hay [lugar] cerca" -> agregar a nearby_zones
- "mala ubicacion/zona/barrio" + usuario menciona otra zona -> location = esa zona

Reglas por tipo de comentario positivo (alta calificacion):
- "me gusta el tamano/espacio/metraje" -> area_min = metros_cuadrados_propiedad - 5
- "buen precio/precio razonable/economico/accesible" -> max_price = precio_propiedad * 1.1
- "me gusta que tiene [amenidad]" -> agregar a common_areas
- "buena ubicacion/zona/barrio" -> location = ubicacion actual
- "buena distribucion/diseno/planta/layout/ambiente" -> keywords = ["buena distribucion"]
- "luminoso/iluminado/buena vista" -> keywords = ["luminoso"]

REGLA CRITICA sobre precio:
- SOLO extrae min_price o max_price si el usuario menciona EXPLICITAMENTE precio, costo, presupuesto,
  "caro", "barato", "economico", "costoso" o palabras equivalentes.
- NO infieras precio a partir de una calificacion alta si el usuario no menciono el precio.
- "distribucion", "diseno", "tamano", "ubicacion", "amenidades" NO son menciones de precio.

Si la informacion no es suficiente para ajustar un parametro, deja ese campo en null o [].
Nunca inventes valores que el usuario no menciono o que no se puedan inferir directamente.
"""


def _normalize_feedback_criteria(raw: dict) -> dict:
    out: dict = {}

    if raw.get("location"):
        out["location"] = str(raw["location"]).strip()
        out["location_mode"] = "preferencia"

    if raw.get("bedrooms") is not None:
        try:
            out["bedrooms"] = int(raw["bedrooms"])
            out["bedrooms_mode"] = "preferencia"
        except (ValueError, TypeError):
            pass

    for key in ("area_min", "area_max"):
        if raw.get(key) is not None:
            try:
                out[key] = int(raw[key])
                out["area_mode"] = "preferencia"
            except (ValueError, TypeError):
                pass

    for key in ("min_price", "max_price"):
        if raw.get(key) is not None:
            try:
                out[key] = float(raw[key])
                out["budget_mode"] = "preferencia"
            except (ValueError, TypeError):
                pass

    if raw.get("common_areas"):
        out["common_areas"] = [str(a).strip() for a in raw["common_areas"] if a]
        out["common_areas_mode"] = "preferencia"

    if raw.get("nearby_zones"):
        out["nearby_zones"] = [str(z).strip() for z in raw["nearby_zones"] if z]
        out["nearby_zones_mode"] = "preferencia"

    if raw.get("keywords"):
        out["keywords"] = [str(k).strip() for k in raw["keywords"] if k]

    out.setdefault("features", [])
    out.setdefault("keywords", out.get("keywords", []))
    return out


def _get_unit_area(property_data: dict) -> float | None:
    """
    Return the area of the specific unit shown to the user, NOT the total building area.
    Priority: (1) modelo/tipologia string, (2) smallest value in apartment range (15-600 m²).
    Values above 600 m² are building/project scale and must be ignored.
    """
    # 1. Try modelo/tipologia/tipo strings — they reliably encode unit size ("TIPO 9 / 41 m2 / ...")
    for key in ("modelo", "tipologia", "tipologia_modelo", "tipo", "model", "unit_type"):
        val = property_data.get(key)
        if isinstance(val, str):
            m = re.search(r'(\d+(?:[.,]\d+)?)\s*m2', val, re.IGNORECASE)
            if m:
                try:
                    v = float(m.group(1).replace(',', '.'))
                    if 15 <= v <= 600:
                        return v
                except ValueError:
                    pass

    # 2. Filter _extract_area_values to apartment-scale values only
    from app.services.matchmaking import _extract_area_values
    unit_areas = [a for a in _extract_area_values(property_data) if 15 <= a <= 600]
    return unit_areas[0] if unit_areas else None


async def extract_rating_feedback_criteria(feedback: str, rating: int, property_data: dict) -> dict:
    """Extract preference adjustments from a post-rating feedback comment."""
    from app.services.matchmaking import (
        _extract_price_values,
        _extract_bedroom_counts,
    )

    prop_area = _get_unit_area(property_data)
    prices = _extract_price_values(property_data)
    bedrooms_set = _extract_bedroom_counts(property_data)

    prop_price = min(prices) if prices else None
    prop_beds = min(bedrooms_set) if bedrooms_set else None
    prop_location = (
        property_data.get("ubicacion")
        or property_data.get("location")
        or property_data.get("distrito")
        or property_data.get("zona")
        or ""
    )

    user_prompt = json.dumps(
        {
            "rating": rating,
            "feedback": feedback,
            "propiedad": {
                "precio": prop_price,
                "metros_cuadrados": prop_area,
                "dormitorios": prop_beds,
                "ubicacion": prop_location or "no especificada",
            },
        },
        ensure_ascii=False,
    )

    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=300,
            system=_RATING_FEEDBACK_SYSTEM,
            messages=[{"role": "user", "content": user_prompt}],
        )
        txt = response.content[0].text.strip()
        if txt.startswith("```"):
            txt = txt.split("```")[1]
            if txt.startswith("json"):
                txt = txt[4:]
        parsed = json.loads(txt.strip())
        return _normalize_feedback_criteria(parsed)
    except Exception as e:
        logger.warning(f"extract_rating_feedback_criteria Claude error: {e}")
        return {}


_CONTEXTUAL_FALLBACK_SYSTEM = """\
Eres un asistente inmobiliario amigable integrado en un chatbot de busqueda de propiedades.
El usuario envio un mensaje que no corresponde a ninguna accion especifica del flujo actual.
Genera una respuesta corta (1-3 oraciones) que sea natural y contextualmente apropiada.

Estados posibles:
- collecting_info/paso 4: esperando que el usuario describa que busca.
- collecting_info/paso 8: usuario tiene preferencias guardadas, se le ofrecio continuar.
- collecting_info/paso 9-10: capturando datos de contacto (pais, nombre, telefono).
- collecting_info/paso 11: esperando parametros de ajuste de busqueda.
- presenting/paso 7: mostrando una propiedad, esperando calificacion o accion.
- contact_requested: el interes ya fue registrado, asesor en camino.

Reglas:
- Si el mensaje es saludo o charla informal: responde con naturalidad e invita a continuar segun el estado.
- Si es una pregunta fuera del dominio inmobiliario: explica brevemente lo que puedes hacer.
- NO inventes propiedades ni datos. NO uses emojis excesivos.
- NUNCA uses listas numeradas ni viñetas. No ofrezcas opciones numeradas (1. ... 2. ...).
- Responde SOLO el texto, sin JSON, sin markdown, en espanol, maximo 2 oraciones.
"""


async def generate_contextual_response(
    user_text: str,
    state: str,
    step: int | None,
    context_summary: str = "",
) -> str:
    """Use Claude to generate a contextually appropriate response when no intent matches."""
    context_line = f"\nPreferencias guardadas del usuario: {context_summary}" if context_summary else ""
    prompt = (
        f"Mensaje del usuario: \"{user_text}\"\n"
        f"Estado actual: {state}, paso: {step}{context_line}"
    )
    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=120,
            system=_CONTEXTUAL_FALLBACK_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.warning(f"generate_contextual_response error: {e}")
        return (
            "Quiero ayudarte bien. "
            "Puedes pedirme que busque propiedades, ajuste preferencias o muestre la siguiente opcion."
        )


_CRITERIA_ACK_SYSTEM = """\
Eres un asistente inmobiliario en espanol.
El usuario acaba de ajustar o cambiar los criterios de su busqueda de propiedades.
Genera UNA sola frase corta y natural en espanol que confirme que entendiste el ajuste.
Menciona brevemente que cambia (precio, zona, dormitorios, etc.).
Reglas:
- Sin "Por supuesto", "Claro que si", "De acuerdo" ni muletillas vacias.
- Sin signos de exclamacion.
- Maximo 15 palabras.
- Solo el texto, sin markdown ni JSON.
"""


async def generate_criteria_acknowledgment(user_text: str) -> str:
    """Generate a short Spanish confirmation that the user's criteria adjustment was understood."""
    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=60,
            system=_CRITERIA_ACK_SYSTEM,
            messages=[{"role": "user", "content": f'El usuario dijo: "{user_text}"'}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.warning(f"generate_criteria_acknowledgment error: {e}")
        return "Entendido, aplicando los nuevos parametros."


_RETURNING_USER_GREETING_SYSTEM = """\
Eres un asesor inmobiliario amigable que retoma la conversacion con un cliente que ya habia hablado contigo antes.
Tu objetivo es darle la bienvenida de forma natural, mencionar brevemente sus preferencias guardadas (sin listas ni datos crudos), \
y preguntarle como quiere continuar.
Reglas:
- Maximo 70 palabras.
- Tono calido y cercano, como un amigo que te conoce.
- Menciona una o dos preferencias clave de forma conversacional, no como una lista.
- Termina con una pregunta abierta o dos opciones breves (sin numeros).
- Sin "Rehidrate", "contexto", "criterios", "registros" ni jerga tecnica.
- Sin signos de exclamacion en exceso (maximo uno).
- NUNCA uses listas numeradas ni opciones (1. ... 2. ...). Las opciones aparecen como botones.
- Solo el texto del mensaje, sin markdown ni JSON.
"""


async def generate_returning_user_greeting(user_name: str, summary: str) -> str:
    """Generate a warm, natural greeting for a returning user with saved preferences."""
    prompt = (
        f"El nombre del cliente es: {user_name}\n"
        f"Sus preferencias guardadas son: {summary}\n"
        "Escribe el mensaje de bienvenida."
    )
    try:
        response = _get_client().messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=150,
            system=_RETURNING_USER_GREETING_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text.strip()
    except Exception as e:
        logger.warning(f"generate_returning_user_greeting error: {e}")
        name_part = user_name if user_name and user_name != "de nuevo" else ""
        greeting = f"Hola{' ' + name_part if name_part else ''}. Qué bueno tenerte de nuevo."
        if summary and summary != "sin criterios guardados todavía":
            greeting += f" Recuerdo que estabas buscando: {summary}."
        greeting += " ¿Seguimos con esa búsqueda o prefieres ajustar algo?"
        return greeting
