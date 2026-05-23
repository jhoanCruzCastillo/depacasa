"""Web chatbot conversation handler â€” session-based, AI-powered."""

import re
import logging
import unicodedata
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.web_chat_session import WebChatSession, WebChatMessage
from app.services.lead_notification_service import notify_active_advisor_for_lead
from app.services.matchmaking import find_matches, get_record_data, _extract_bedroom_counts
from app.services.preference_service import (
    build_preferences_v2_from_criteria,
    criteria_from_preferences_v2,
    default_preferences_v2,
    merge_consolidated_context,
    summarize_preferences_v2,
)
from app.services.chatbot_intents.context import IntentRuntime
from app.services.chatbot_intents.engine import candidate_intents_for_state, dispatch_intents

logger = logging.getLogger(__name__)

_GREETING = (
    "Hola. Soy tu asistente inmobiliario. "
    "Estoy aquí para ayudarte a encontrar una propiedad que encaje contigo. "
    "¿Qué estás buscando exactamente?"
)


# â”€â”€ Response builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _text(msg: str) -> dict:
    return {"message": msg, "card": None, "state": "collecting_info"}


def _property_card(
    msg: str,
    index: int,
    total: int,
    record_id: str,
    data: dict,
    state: str = "presenting",
    seen_by_user_before: bool | None = None,
    user_rating: int | None = None,
) -> dict:
    return {
        "message": msg,
        "card": {
            "index": index,
            "total": total,
            "record_id": record_id,
            "property_identifier": record_id,
            "seen_by_user_before": seen_by_user_before,
            "user_rating": user_rating,
            "data": data,
        },
        "state": state,
    }


_BED_WORDS = {
    "un": 1,
    "uno": 1,
    "una": 1,
    "dos": 2,
    "tres": 3,
    "cuatro": 4,
    "cinco": 5,
    "seis": 6,
    "siete": 7,
    "ocho": 8,
}


def _normalize_text(s: str) -> str:
    return "".join(
        c
        for c in unicodedata.normalize("NFD", (s or "").lower())
        if unicodedata.category(c) != "Mn"
    )


def _extract_explicit_bedrooms(description: str) -> int | None:
    """Extract explicit bedroom count from text and handle correction phrases."""
    desc = _normalize_text(description)
    pattern = re.compile(
        r"(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho)\s*"
        r"(?:dorm(?:itorio)?s?|hab(?:itacion(?:es)?)?|cuartos?|bedrooms?|recamaras?)",
        re.IGNORECASE,
    )

    matches: list[tuple[int, int]] = []
    for m in pattern.finditer(desc):
        token = m.group(1).lower()
        val = _BED_WORDS.get(token)
        if val is None and token.isdigit():
            val = int(token)
        if val and 0 < val <= 10:
            matches.append((m.start(), val))

    if not matches:
        return None
    if len(matches) == 1:
        return matches[0][1]

    # Prefer first non-negated mention (e.g. "de 2 habitaciones, no de 1").
    for pos, val in matches:
        context = desc[max(0, pos - 10):pos]
        if "no de" not in context and not context.rstrip().endswith("no"):
            return val
    return matches[-1][1]


def _extract_explicit_bathrooms(description: str) -> int | None:
    desc = _normalize_text(description)
    pattern = re.compile(
        r"(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho)\s*"
        r"(?:banos?|bath(?:rooms?)?|aseos?)",
        re.IGNORECASE,
    )
    m = pattern.search(desc)
    if not m:
        return None
    token = m.group(1).lower()
    val = _BED_WORDS.get(token)
    if val is None and token.isdigit():
        val = int(token)
    return val if val and 0 < val <= 10 else None


def _extract_explicit_area_range(description: str) -> tuple[int | None, int | None, int | None]:
    text = _normalize_text(description)
    range_m = re.search(
        r"(?:entre|de)\s*(\d{2,4})\s*(?:m2|metros?(?:\s+cuadrados?)?|mt2)\s*(?:y|-|a)\s*(\d{2,4})",
        text,
        re.IGNORECASE,
    )
    if range_m:
        first = int(range_m.group(1))
        second = int(range_m.group(2))
        return min(first, second), max(first, second), None

    exact_m = re.search(
        r"(\d{2,4})\s*(?:m2|metros?(?:\s+cuadrados?)?|mt2)\b",
        text,
        re.IGNORECASE,
    )
    if exact_m:
        return None, None, int(exact_m.group(1))
    return None, None, None


def _extract_common_areas(text: str) -> list[str]:
    norm = _normalize_text(text)
    catalog = {
        "gimnasio": ["gimnasio", "gym", "area deportiva", "zona deportiva"],
        "piscina": ["piscina", "pool"],
        "parrilla": ["parrilla", "zona bbq", "bbq"],
        "cowork": ["cowork", "coworking"],
        "juegos": ["juegos para ninos", "zona de juegos", "juegos infantiles"],
        "pet friendly": ["pet friendly", "mascotas"],
        "terraza": ["terraza", "roof top", "rooftop"],
        "sum": ["sum", "salon de usos multiples"],
    }
    found: list[str] = []
    for label, variants in catalog.items():
        if any(v in norm for v in variants):
            found.append(label)
    return found


def _extract_preference_mode(text: str, aliases: list[str], default: str = "preferencia") -> str:
    norm = _normalize_text(text)
    if not any(alias in norm for alias in aliases):
        return default
    if any(
        token in norm
        for token in [
            "obligatorio",
            "si o si",
            "si o sí",
            "indispensable",
            "no negociable",
            "debe tener",
            "tiene que tener",
        ]
    ):
        return "obligatorio"
    if any(
        token in norm
        for token in ["preferencia", "preferible", "idealmente", "de ser posible", "si es posible"]
    ):
        return "preferencia"
    return default


def _parse_money_amount(raw: str, suffix: str | None = None) -> float | None:
    token = (raw or "").strip()
    if not token:
        return None
    token = re.sub(r"[^\d,.\s]", "", token).replace(" ", "")
    if not token:
        return None

    if "." in token and "," in token:
        token = token.replace(".", "").replace(",", "")
    elif "," in token:
        parts = token.split(",")
        token = "".join(parts) if len(parts[-1]) == 3 else token.replace(",", ".")
    elif "." in token:
        parts = token.split(".")
        token = "".join(parts) if len(parts[-1]) == 3 else token

    try:
        value = float(token)
    except ValueError:
        return None

    sfx = _normalize_text(suffix or "")
    if sfx in {"k", "mil"}:
        value *= 1_000
    elif sfx in {"m", "mm", "millon", "millones"}:
        value *= 1_000_000
    return value if value > 0 else None


def _extract_explicit_price_limits(description: str) -> tuple[float | None, float | None]:
    text = _normalize_text(description)
    money = r"([0-9][0-9\.,\s]{0,15})(?:\s*(k|mil|m|mm|millon|millones))?"
    ccy = r"(?:us\$|usd|dolares?|soles?|s\/\.?)?\s*"

    min_price: float | None = None
    max_price: float | None = None

    range_m = re.search(rf"\bentre\s+{ccy}{money}\s+y\s+{ccy}{money}", text, re.IGNORECASE)
    if range_m:
        first = _parse_money_amount(range_m.group(1), range_m.group(2))
        second = _parse_money_amount(range_m.group(3), range_m.group(4))
        if first and second:
            min_price, max_price = (first, second) if first <= second else (second, first)

    max_m = re.search(
        rf"\b(?:menos\s+de|maximo(?:\s+de)?|hasta|tope(?:\s+de)?|no\s+mas\s+de)\s+{ccy}{money}",
        text,
        re.IGNORECASE,
    )
    if max_m:
        parsed = _parse_money_amount(max_m.group(1), max_m.group(2))
        if parsed:
            max_price = parsed

    min_m = re.search(
        rf"\b(?:desde|minimo(?:\s+de)?|al\s+menos|mas\s+de|mayor\s+a)\s+{ccy}{money}",
        text,
        re.IGNORECASE,
    )
    if min_m:
        parsed = _parse_money_amount(min_m.group(1), min_m.group(2))
        if parsed:
            min_price = parsed

    return min_price, max_price


def _clean_criteria(criteria: dict | None) -> dict:
    return {k: v for k, v in (criteria or {}).items() if not str(k).startswith("_")}


def _has_actionable_criteria(criteria: dict | None) -> bool:
    c = _clean_criteria(criteria)
    if (
        c.get("location")
        or c.get("bedrooms")
        or c.get("bathrooms")
        or c.get("area_exact")
        or c.get("area_min")
        or c.get("area_max")
        or c.get("min_price")
        or c.get("max_price")
    ):
        return True
    if c.get("features") or c.get("keywords") or c.get("nearby_zones") or c.get("common_areas"):
        return True
    return False


def _is_affirmative_message(text: str) -> bool:
    yes_words = {
        "si", "sí", "claro", "dale", "ok", "okay", "bueno", "vamos",
        "adelante", "perfecto", "listo", "de acuerdo", "hazlo", "busca",
    }
    norm = _normalize_text(text).strip()
    if not norm:
        return False
    if norm in yes_words:
        return True
    tokens = re.findall(r"[a-z0-9]+", norm)
    if not tokens:
        return False
    if tokens[0] in yes_words:
        return True
    if tokens[0] in {"si", "sí"}:
        return True
    return any(w in norm for w in ["verlas", "ver opciones", "mostrar opciones", "quiero ver", "si, ver", "si ver"])


def _is_negative_message(text: str) -> bool:
    no_words = {
        "no", "nop", "nada", "todavia", "todavía", "luego", "despues", "después",
        "aun no", "aún no", "ahorita no",
    }
    norm = _normalize_text(text).strip()
    if not norm:
        return False
    if norm in no_words:
        return True
    return norm.split()[0] in no_words


def _looks_like_search_update(text: str) -> bool:
    norm = _normalize_text(text)
    if _extract_explicit_bedrooms(text):
        return True
    pmin, pmax = _extract_explicit_price_limits(text)
    if pmin or pmax:
        return True
    hints = [
        "departamento", "depa", "propiedad", "casa", "dormitorio", "habitacion",
        "cuarto", "presupuesto", "precio", "zona", "distrito", "ubicacion",
        "miraflores", "surco", "cerca", "cercano", "cercana", "alrededor",
    ]
    return any(h in norm for h in hints)


def _merge_unique_terms(base: list[str] | None, extra: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for term in (base or []) + (extra or []):
        value = str(term or "").strip()
        if not value:
            continue
        key = _normalize_text(value)
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def _extract_nearby_preferences(text: str) -> list[str]:
    t = _normalize_text(text)
    patterns = [
        r"cerca\s+(?:a|de|del)?\s+([a-z0-9\s\-]{3,40})",
        r"cercano\s+(?:a|de|del)?\s+([a-z0-9\s\-]{3,40})",
        r"cercana\s+(?:a|de|del)?\s+([a-z0-9\s\-]{3,40})",
        r"alrededor\s+de\s+([a-z0-9\s\-]{3,40})",
    ]
    stop_words = {
        "zona", "ciudad", "distrito", "ubicacion", "presupuesto", "precio",
        "dormitorio", "dormitorios", "habitacion", "habitaciones", "cuarto", "cuartos",
    }

    out: list[str] = []
    for pattern in patterns:
        for m in re.finditer(pattern, t, re.IGNORECASE):
            raw = re.split(r"[,\.;\n]", m.group(1))[0].strip()
            raw = re.sub(r"\s+", " ", raw).strip(" -")
            if not raw:
                continue
            if raw in stop_words:
                continue
            phrase = f"cerca de {raw}"
            out.append(phrase)
    return _merge_unique_terms([], out)


def _format_budget(min_price: float | None, max_price: float | None) -> str | None:
    def _fmt(v: float) -> str:
        return f"{int(v):,}".replace(",", ".")

    if min_price and max_price:
        return f"entre {_fmt(min_price)} y {_fmt(max_price)}"
    if max_price:
        return f"hasta {_fmt(max_price)}"
    if min_price:
        return f"desde {_fmt(min_price)}"
    return None


def _summarize_preferences(criteria: dict | None) -> str:
    c = _clean_criteria(criteria)
    parts: list[str] = []
    loc = (c.get("location") or "").strip()
    beds = c.get("bedrooms")
    baths = c.get("bathrooms")
    if loc:
        parts.append(f"zona: {loc}")
    if beds:
        hab = "dormitorio" if beds == 1 else "dormitorios"
        parts.append(f"{beds} {hab}")
    if baths:
        btxt = "baño" if baths == 1 else "baños"
        parts.append(f"{baths} {btxt}")
    if c.get("area_exact"):
        parts.append(f"{c.get('area_exact')} m2")
    elif c.get("area_min") or c.get("area_max"):
        parts.append(f"área {c.get('area_min', '?')}–{c.get('area_max', '?')} m2")
    budget = _format_budget(c.get("min_price"), c.get("max_price"))
    if budget:
        parts.append(f"presupuesto {budget}")
    nearby = c.get("nearby_zones") or []
    if nearby:
        parts.append(f"zonas cercanas: {', '.join(nearby[:2])}")
    common = c.get("common_areas") or []
    if common:
        parts.append(f"áreas comunes: {', '.join(common[:2])}")
    if not parts:
        return "sin criterios guardados todavia"
    return ", ".join(parts)


def _extract_project_status_value(data: dict | None) -> str | None:
    if not isinstance(data, dict):
        return None

    key_hints = {"estado", "status", "situacion", "disponibilidad", "etapa", "fase"}
    values: list[str] = []

    def _walk(obj, key: str = "") -> None:
        norm_key = _normalize_text(key or "")
        if isinstance(obj, str):
            text = obj.strip()
            if not text:
                return
            if any(h in norm_key for h in key_hints):
                values.append(text)
            return
        if isinstance(obj, (int, float)):
            if any(h in norm_key for h in key_hints):
                values.append(str(obj))
            return
        if isinstance(obj, list):
            for item in obj:
                _walk(item, key)
            return
        if isinstance(obj, dict):
            for k, v in obj.items():
                _walk(v, str(k))

    _walk(data)
    if values:
        return values[0][:120]

    # Fallback semantico por si la clave no es estandar.
    all_text = " ".join(str(v) for v in data.values() if isinstance(v, (str, int, float)))
    if any(token in _normalize_text(all_text) for token in ["lanzamiento", "preventa", "construccion", "entrega"]):
        return all_text[:120]
    return None


def _build_project_status_warning(data: dict | None) -> str | None:
    status = _extract_project_status_value(data)
    if not status:
        return None
    st = _normalize_text(status)

    ready_tokens = ["entrega inmediata", "listo para entrega", "entrega en curso", "inmediata"]
    not_ready_tokens = [
        "proximo lanzamiento", "proximo", "lanzamiento",
        "preventa", "pre venta",
        "en construccion", "en obra", "por lanzar",
    ]

    if any(t in st for t in ready_tokens):
        return None
    if any(t in st for t in not_ready_tokens):
        return (
            f"Importante: este proyecto figura como \"{status}\". "
            "Podría no estar listo para entrega inmediata."
        )
    return None


def _is_scope_message(text: str) -> bool:
    norm = _normalize_text(text)
    if not norm:
        return True
    hints = [
        "hola", "propiedad", "propiedades", "departamento", "depa", "casa",
        "zona", "ubicacion", "distrito", "dormitorio", "habitacion", "cuarto",
        "precio", "presupuesto", "bano", "bano", "siguiente", "otra",
        "ver", "calificar", "estrellas", "lo quiero", "interesa", "asesor",
        "contacto", "whatsapp", "pais", "peru", "mexico", "colombia",
    ]
    return any(h in norm for h in hints)


def _fallback_out_of_scope() -> dict:
    return _text(
        "Lo siento, esa petición escapa de mis funciones. "
        "Puedo ayudarte a encontrar propiedades, ajustar preferencias o registrar tu interés en una opción."
    )


def _fallback_not_understood() -> dict:
    return _text(
        "Quiero ayudarte bien, pero no estoy seguro de haber entendido. "
        "¿Quieres buscar una propiedad, cambiar filtros o ver la siguiente opción?"
    )


def _is_new_unseen_request(text: str) -> bool:
    t = _normalize_text(text)
    if t.strip() in {"1", "uno", "nuevas", "nueva"}:
        return True

    patterns = [
        "propiedades nuevas",
        "nuevas propiedades",
        "no vistas",
        "no he visto",
        "aun no he visto",
        "aun no vi",
        "aun no veo",
        "todavia no he visto",
        "todavia no vi",
        "que aun no he visto",
        "que aun no veo",
        "sin ver",
        "que no vi",
        "que no he visto",
        "no me mostraste",
    ]
    if any(p in t for p in patterns):
        return True

    # Fallback semantico: combinacion de "ver/visto" + negacion en frases de propiedades.
    about_properties = any(k in t for k in ["propiedad", "propiedades", "opcion", "opciones"])
    has_see_verb = any(k in t for k in ["ver", "veo", "vi", "visto"])
    has_negation = any(k in t for k in ["no", "aun", "todavia", "nunca"])
    return about_properties and has_see_verb and has_negation


def _is_viewed_request(text: str) -> bool:
    t = _normalize_text(text)
    if _is_new_unseen_request(text):
        return False
    return (
        "ya revisaste" in t
        or "ya vistas" in t
        or "vistas" in t
        or "anteriores" in t
        or t.strip() in {"2", "dos"}
    )


def _is_interested_list_request(text: str) -> bool:
    t = _normalize_text(text)
    patterns = [
        "propiedades a las cuales tengo interes",
        "propiedades que me interesan",
        "propiedades de interes",
        "mis propiedades de interes",
        "ver mis intereses",
        "ver propiedades interesadas",
    ]
    return any(p in t for p in patterns)


def _is_mark_current_property_interest(text: str) -> bool:
    t = _normalize_text(text)
    if "lo quiero" in t:
        return True
    if "me interesa" in t:
        return True
    if "interesa esta" in t or "interesa este" in t:
        return True
    if "quiero esta" in t or "quiero este" in t:
        return True
    return False


def _is_adjust_search_intent(text: str) -> bool:
    t = _normalize_text(text)
    hints = [
        "ajustar busqueda",
        "ajustar la busqueda",
        "ajustar parametros",
        "ajustar filtros",
        "cambiar parametros",
        "cambiar filtros",
        "cambiar zona",
        "cambiar ciudad",
        "cambiar zona o ciudad",
        "otra zona",
        "otra ciudad",
        "modificar parametros",
        "nueva busqueda",
        "quiero ajustar",
    ]
    return any(h in t for h in hints)


def _contains_adjustment_details(text: str) -> bool:
    t = _normalize_text(text)
    if not t.strip():
        return False

    if _extract_explicit_bedrooms(text):
        return True
    pmin, pmax = _extract_explicit_price_limits(text)
    if pmin is not None or pmax is not None:
        return True

    # Explicit location value, e.g. "zona miraflores", "ciudad arequipa", "en surco".
    if re.search(
        r"\b(?:zona|ciudad|distrito|ubicacion|localidad)\s+(?:a|en|de)?\s*[a-z0-9][a-z0-9\-\s]{2,}",
        t,
        re.IGNORECASE,
    ):
        return True
    if re.search(r"\ben\s+[a-z0-9][a-z0-9\-\s]{2,}", t, re.IGNORECASE):
        return True

    # Bare location token after an adjustment prompt, e.g. "Miraflores".
    tokens = re.findall(r"[a-z0-9]+", t)
    ignored = {
        "si", "no", "ok", "okay", "hola", "gracias",
        "ajustar", "ajuste", "cambiar", "cambio", "filtro", "filtros",
        "parametro", "parametros", "busqueda", "zona", "ciudad", "distrito", "ubicacion",
    }
    if 1 <= len(tokens) <= 3 and not any(tok in ignored for tok in tokens):
        return True
    return False


def _is_generic_adjust_request(text: str) -> bool:
    if not _is_adjust_search_intent(text):
        return False
    return not _contains_adjustment_details(text)


def _extract_rating_from_text(text: str) -> int | None:
    t = _normalize_text(text)
    m = re.search(r"\b([1-5])\s*estrella", t)
    if m:
        return int(m.group(1))
    if t.strip() in {"1", "2", "3", "4", "5"}:
        return int(t.strip())
    return None


def _rating_feedback(rating: int) -> str:
    if rating == 1:
        return (
            "Entendido, esta opción no va contigo. "
            "La tomaré como señal para evitar mostrarte propiedades demasiado parecidas."
        )
    if rating == 2:
        return (
            "Gracias, parece que esta opción no encaja del todo. "
            "Ajustaré mejor las siguientes recomendaciones."
        )
    if rating == 3:
        return "Bien, la dejaré como opción posible, pero seguiré buscando algo que encaje mejor."
    if rating == 4:
        return (
            "Buena señal. Esta propiedad se acerca bastante a lo que buscas, "
            "así que tomaré sus características como referencia."
        )
    return (
        "Excelente, esta parece una opción muy fuerte para ti. "
        "Guardaré esta preferencia para mostrarte propiedades similares."
    )


def _country_to_doc_label(country: str | None) -> str:
    c = _normalize_text(country or "")
    if "peru" in c:
        return "DNI / Carné de Extranjería"
    if "mexico" in c:
        return "CURP / INE"
    if "colombia" in c:
        return "Cédula de ciudadanía"
    if "chile" in c:
        return "RUT"
    if "argentina" in c:
        return "DNI"
    if "espana" in c:
        return "DNI / NIE"
    return "Documento de identidad"


def _digits_only(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def _looks_like_peru_dni(value: str | None) -> bool:
    digits = _digits_only(value)
    return len(digits) == 8


def _normalize_document(value: str | None) -> str | None:
    if not value:
        return None
    token = re.sub(r"\s+", "", value).upper()
    if not re.search(r"\d", token):
        return None
    if len(token) < 5 or len(token) > 20:
        return None
    return token


def _normalize_whatsapp(value: str | None, country: str | None = None, document: str | None = None) -> str | None:
    if not value:
        return None

    raw = value.strip()
    digits = _digits_only(raw)
    if not digits:
        return None

    doc_digits = _digits_only(document)
    if doc_digits and digits == doc_digits:
        return None

    norm_country = _normalize_text(country or "")
    if "peru" in norm_country:
        if len(digits) == 9 and digits.startswith("9"):
            return digits
        if len(digits) == 11 and digits.startswith("51") and digits[2] == "9":
            return f"+{digits}"
        return None

    if len(digits) < 9 or len(digits) > 15:
        return None
    return f"+{digits}" if raw.startswith("+") else digits


def _extract_labeled_value(text: str, labels: list[str]) -> str | None:
    if not text:
        return None
    label_group = "|".join(re.escape(l) for l in labels)
    pattern = re.compile(
        rf"(?:^|[\n,;])\s*(?:{label_group})\s*[:\-]\s*([^\n,;]+)",
        re.IGNORECASE,
    )
    m = pattern.search(text)
    return m.group(1).strip() if m else None


def _extract_whatsapp(text: str, country: str | None = None, document: str | None = None) -> str | None:
    labeled = _extract_labeled_value(
        text,
        ["whatsapp", "wsp", "ws", "telefono", "tel", "celular", "cel", "phone"],
    )
    if labeled:
        normalized = _normalize_whatsapp(labeled, country=country, document=document)
        if normalized:
            return normalized

    for m in re.finditer(r"[\+]?[\d][\d\s\-\(\)\.]{6,17}[\d]", text or ""):
        normalized = _normalize_whatsapp(m.group(), country=country, document=document)
        if normalized:
            return normalized
    return None


def _extract_document(text: str) -> str | None:
    labeled = _extract_labeled_value(
        text,
        [
            "dni", "ce", "carnet", "carné", "doc", "documento", "pasaporte",
            "rut", "curp", "ine", "nie", "cedula", "cédula",
        ],
    )
    normalized_labeled = _normalize_document(labeled)
    if normalized_labeled:
        return normalized_labeled

    for m in re.finditer(r"\b[A-Za-z0-9\-]{5,20}\b", text):
        token = _normalize_document(m.group())
        if token and any(ch.isdigit() for ch in token):
            return token
    return None


def _extract_full_name(text: str) -> str | None:
    line = text.strip()
    if not line:
        return None
    if any(ch.isdigit() for ch in line):
        return None
    parts = [p for p in re.split(r"\s+", line) if p]
    if len(parts) < 2:
        return None
    return " ".join(w.capitalize() for w in parts[:6])


def _extract_first_url(text: str) -> str | None:
    if not text:
        return None
    m = re.search(r"(/media/[^\s<>\]\)\"']+)", text, re.IGNORECASE)
    if m:
        return m.group(1).rstrip(".,;)")
    m = re.search(r"(https?://[^\s<>\]\)\"']+)", text, re.IGNORECASE)
    if m:
        return m.group(1).rstrip(".,;)")
    m = re.search(r"\b(?:www\.)[^\s<>\]\)\"']+\b", text, re.IGNORECASE)
    if m:
        return f"https://{m.group(0).rstrip('.,;)')}"
    return None


def _extract_financial_capacity_doc(text: str) -> str | None:
    url = _extract_first_url(text or "")
    if url:
        return url

    labeled = _extract_labeled_value(
        text or "",
        [
            "sustento",
            "sustento financiero",
            "capacidad financiera",
            "documento financiero",
            "documento",
            "enlace",
            "link",
            "url",
            "archivo",
            "pdf",
        ],
    )
    url = _extract_first_url(labeled or "")
    if url:
        return url

    token_match = re.search(
        r"\b([A-Za-z0-9_\-/\.]{8,}\.(?:pdf|png|jpg|jpeg|webp|heic|doc|docx))\b",
        text or "",
        re.IGNORECASE,
    )
    if token_match:
        return token_match.group(1)
    return None


def _looks_like_financial_doc_text(text: str) -> bool:
    norm = _normalize_text(text or "")
    return any(
        token in norm
        for token in [
            "sustento financiero",
            "capacidad financiera",
            "preaprobacion",
            "pre aprobacion",
            "aprobacion bancaria",
            "estado de cuenta",
            "declaracion de renta",
            "declaracion jurada",
            "pdf",
            "documento",
            "enlace",
            "link",
            "/media/",
            "drive.google.com",
            "dropbox",
            "onedrive",
        ]
    )


def _is_house_interest_context(session: WebChatSession, record_id: str | None, db: Session) -> bool:
    source_parts: list[str] = []
    if session.ideal_description:
        source_parts.append(str(session.ideal_description))
    criteria = session.extracted_criteria if isinstance(session.extracted_criteria, dict) else {}
    source_parts.extend(str(v) for v in (criteria.get("keywords") or []) if v)
    source_parts.extend(str(v) for v in (criteria.get("features") or []) if v)

    if record_id:
        data = get_record_data(db, record_id) or {}
        if isinstance(data, dict):
            for value in data.values():
                if isinstance(value, (str, int, float)):
                    source_parts.append(str(value))

    text = _normalize_text(" ".join(source_parts))
    house_tokens = ["casa", "house", "chalet", "townhouse", "duplex", "duplex"]
    return any(token in text for token in house_tokens)


def _build_financial_doc_request_message() -> str:
    return (
        "Excelente. Para continuar con tu solicitud, necesito un sustento de capacidad de compra "
        "(por ejemplo preaprobacion bancaria, credito aprobado o ayuda social).\n\n"
        "Comparte el enlace del documento (PDF/JPG/Drive) para continuar."
    )


def _get_latest_saved_lead(site_user_id, db: Session, exclude_session_id: UUID | None = None) -> dict:
    try:
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        q = db.query(WebChatSession).filter(WebChatSession.site_user_id == uid)
        if exclude_session_id:
            q = q.filter(WebChatSession.id != exclude_session_id)
        rows = (
            q.order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
            .limit(30)
            .all()
        )
        for s in rows:
            criteria = s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {}
            candidate = criteria.get("_lead")
            if isinstance(candidate, dict) and candidate:
                return dict(candidate)
    except Exception as e:
        logger.warning(f"[lead] could not load latest lead: {e}")
    return {}


def _hydrate_lead_from_db(session: WebChatSession, lead: dict, db: Session) -> dict:
    merged = dict(lead or {})

    if session.country and not merged.get("country_of_residence"):
        merged["country_of_residence"] = session.country
    if session.name and not merged.get("full_name"):
        merged["full_name"] = session.name
    if session.phone and not merged.get("whatsapp"):
        merged["whatsapp"] = session.phone

    su = None
    if session.site_user_id:
        try:
            from app.models.site_user import SiteUser
            su = db.query(SiteUser).filter(SiteUser.id == session.site_user_id).first()
        except Exception as e:
            logger.warning(f"[lead] could not load site user: {e}")

    if su:
        if su.country and not merged.get("country_of_residence"):
            merged["country_of_residence"] = su.country
        if su.name and not merged.get("full_name"):
            merged["full_name"] = su.name

    latest_saved = (
        _get_latest_saved_lead(session.site_user_id, db, exclude_session_id=session.id)
        if session.site_user_id else {}
    )
    if latest_saved.get("country_of_residence") and not merged.get("country_of_residence"):
        merged["country_of_residence"] = latest_saved.get("country_of_residence")
    if latest_saved.get("full_name") and not merged.get("full_name"):
        merged["full_name"] = latest_saved.get("full_name")
    if latest_saved.get("document_number") and not merged.get("document_number"):
        merged["document_number"] = latest_saved.get("document_number")
    if latest_saved.get("whatsapp") and not merged.get("whatsapp"):
        merged["whatsapp"] = latest_saved.get("whatsapp")
    if latest_saved.get("financial_capacity_doc") and not merged.get("financial_capacity_doc"):
        merged["financial_capacity_doc"] = latest_saved.get("financial_capacity_doc")
    if latest_saved.get("requires_financial_capacity_doc") and not merged.get("requires_financial_capacity_doc"):
        merged["requires_financial_capacity_doc"] = latest_saved.get("requires_financial_capacity_doc")

    lead_country = merged.get("country_of_residence")
    doc = _normalize_document(merged.get("document_number"))
    if doc:
        merged["document_number"] = doc
    elif merged.get("document_number"):
        merged.pop("document_number", None)

    if not merged.get("whatsapp") and su and su.phone:
        merged["whatsapp"] = su.phone

    whatsapp = _normalize_whatsapp(merged.get("whatsapp"), country=lead_country, document=doc)
    if whatsapp:
        merged["whatsapp"] = whatsapp
    elif merged.get("whatsapp"):
        merged.pop("whatsapp", None)

    return merged


def _get_missing_lead_fields(lead: dict) -> list[str]:
    missing: list[str] = []
    if not lead.get("country_of_residence"):
        missing.append("pais de residencia")
    if not lead.get("full_name"):
        missing.append("nombres y apellidos")
    if not lead.get("whatsapp"):
        missing.append("WhatsApp")
    if not lead.get("document_number"):
        missing.append(_country_to_doc_label(lead.get("country_of_residence")))
    return missing


def _build_contact_request_message(lead: dict) -> str:
    missing = _get_missing_lead_fields(lead)
    if not missing:
        return "Listo, con tus datos guardados ya puedo registrar tu solicitud."
    if len(missing) == 1:
        return f"Perfecto. Ya tengo casi todo. Solo comparteme tu {missing[0]} para contactarte."
    return (
        "Perfecto. Para que un asesor pueda contactarte, me faltan estos datos:\n"
        + "\n".join(f"- {item}" for item in missing)
    )


def _finalize_lead_request(session: WebChatSession, clean: dict, lead: dict, db: Session) -> dict:
    must_have_financial_doc = bool(lead.get("requires_financial_capacity_doc") or lead.get("record_id"))
    if must_have_financial_doc and not lead.get("financial_capacity_doc"):
        lead["requires_financial_capacity_doc"] = True
        session.extracted_criteria = {**clean, "_lead": lead}
        session.info_step = 12
        session.state = "collecting_info"
        return _text(_build_financial_doc_request_message())

    lead_country = lead.get("country_of_residence") or session.country
    session.name = lead.get("full_name") or session.name
    session.phone = lead.get("whatsapp") or session.phone
    if lead_country:
        session.country = lead_country

    if session.site_user_id:
        try:
            from app.models.site_user import SiteUser
            su = db.query(SiteUser).filter(SiteUser.id == session.site_user_id).first()
            if su:
                su.name = su.name or lead.get("full_name")
                stored_phone = _normalize_whatsapp(
                    su.phone,
                    country=lead_country,
                    document=lead.get("document_number"),
                )
                if lead.get("whatsapp") and (not su.phone or not stored_phone):
                    su.phone = lead.get("whatsapp")
                su.country = su.country or lead_country
        except Exception as e:
            logger.warning(f"[lead] could not persist contact data: {e}")

    record_id = lead.get("record_id")
    if session.site_user_id and record_id:
        _upsert_interaction(session.site_user_id, record_id, db, interested=True)

    sent_to_advisor, lead = notify_active_advisor_for_lead(session, db, lead)
    if sent_to_advisor and session.site_user_id and record_id:
        _upsert_interaction(session.site_user_id, record_id, db, sent_by_email=True)
    session.extracted_criteria = {**clean, "_lead": lead}
    if session.site_user_id:
        _save_preferences(
            session.site_user_id,
            {**clean, "_lead": lead},
            session.ideal_description or "",
            db,
            extra_context={
                "lead_profile": {
                    "full_name": lead.get("full_name"),
                    "country": lead.get("country_of_residence"),
                    "whatsapp": lead.get("whatsapp"),
                    "document": lead.get("document_number"),
                    "financial_capacity_doc": lead.get("financial_capacity_doc"),
                },
                "conversation_memory": {"last_intent": "capturar_datos_contacto"},
            },
        )

    session.info_step = 4
    session.state = "collecting_info"
    return _text(
        "Listo, ya registré tu interés en esta propiedad. "
        "Un asesor podrá contactarte por WhatsApp para darte más información. "
        "Si quieres, también puedo seguir mostrándote opciones similares."
    )


def _get_viewed_record_ids(site_user_id, db: Session) -> list[str]:
    try:
        from app.models.user_property_interaction import UserPropertyInteraction
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        rows = (
            db.query(UserPropertyInteraction)
            .filter(
                UserPropertyInteraction.site_user_id == uid,
                UserPropertyInteraction.seen_in_chat.is_(True),
            )
            .order_by(UserPropertyInteraction.seen_at.desc().nullslast())
            .all()
        )
        ids: list[str] = []
        seen: set[str] = set()
        for r in rows:
            rid = str(r.record_id)
            if rid in seen:
                continue
            seen.add(rid)
            ids.append(rid)
        return ids
    except Exception as e:
        logger.warning(f"[tracking] could not fetch viewed ids: {e}")
        return []


def _get_viewed_source_urls(site_user_id, db: Session) -> set[str]:
    """Return detail-page source URLs already seen by the user across chats."""
    try:
        from app.models.user_property_interaction import UserPropertyInteraction
        from app.models.propiedad import Propiedad
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        rows = (
            db.query(Propiedad.source_url)
            .join(UserPropertyInteraction, UserPropertyInteraction.record_id == Propiedad.id)
            .filter(
                UserPropertyInteraction.site_user_id == uid,
                UserPropertyInteraction.seen_in_chat.is_(True),
                Propiedad.source_url.isnot(None),
            )
            .all()
        )
        out: set[str] = set()
        for row in rows:
            url = (row[0] or "").strip()
            if url:
                out.add(url)
        return out
    except Exception as e:
        logger.warning(f"[tracking] could not fetch viewed source urls: {e}")
        return set()


def _get_record_source_url(db: Session, record_id: str) -> str:
    try:
        from app.models.propiedad import Propiedad
        rid = UUID(record_id)
        row = db.query(Propiedad.source_url).filter(Propiedad.id == rid).first()
        return (row[0] or "").strip() if row else ""
    except Exception:
        return ""


def _exclude_seen_sources(db: Session, candidate_ids: list[str], seen_urls: set[str]) -> list[str]:
    if not seen_urls:
        return candidate_ids
    filtered: list[str] = []
    for rid in candidate_ids:
        src = _get_record_source_url(db, rid)
        if src and src in seen_urls:
            continue
        filtered.append(rid)
    return filtered


def _get_viewed_ranked_ids(site_user_id, db: Session) -> list[str]:
    try:
        from app.models.user_property_interaction import UserPropertyInteraction
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        rows = (
            db.query(UserPropertyInteraction)
            .filter(
                UserPropertyInteraction.site_user_id == uid,
                UserPropertyInteraction.seen_in_chat.is_(True),
            )
            .order_by(
                UserPropertyInteraction.rating.desc().nullslast(),
                UserPropertyInteraction.seen_at.desc().nullslast(),
            )
            .all()
        )
        ids: list[str] = []
        seen: set[str] = set()
        for r in rows:
            rid = str(r.record_id)
            if rid in seen:
                continue
            seen.add(rid)
            ids.append(rid)
        return ids
    except Exception as e:
        logger.warning(f"[tracking] could not fetch viewed ranked ids: {e}")
        return []


def _get_interested_record_ids(site_user_id, db: Session) -> list[str]:
    try:
        from app.models.user_property_interaction import UserPropertyInteraction
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        rows = (
            db.query(UserPropertyInteraction)
            .filter(
                UserPropertyInteraction.site_user_id == uid,
                UserPropertyInteraction.interested.is_(True),
            )
            .order_by(
                UserPropertyInteraction.rated_at.desc().nullslast(),
                UserPropertyInteraction.updated_at.desc().nullslast(),
                UserPropertyInteraction.created_at.desc(),
            )
            .all()
        )
        ids: list[str] = []
        seen: set[str] = set()
        for r in rows:
            rid = str(r.record_id)
            if rid in seen:
                continue
            seen.add(rid)
            ids.append(rid)
        return ids
    except Exception as e:
        logger.warning(f"[tracking] could not fetch interested ids: {e}")
        return []


def _get_exhausted_revisit_ids(ctx: dict | None) -> list[str]:
    ids = (ctx or {}).get("_exhausted_unseen_ids")
    if not isinstance(ids, list):
        return []
    return [str(x) for x in ids if x]


async def _show_interested_properties(session: WebChatSession, db: Session) -> dict:
    if not session.site_user_id:
        return _text(
            "No tengo un usuario identificado para recuperar tus intereses. "
            "Si quieres, primero te muestro propiedades y marcamos las que te gusten."
        )
    interested_ids = _get_interested_record_ids(session.site_user_id, db)
    if not interested_ids:
        return _text("Aun no tienes propiedades marcadas como interesadas.")

    clean = _clean_criteria(session.extracted_criteria)
    session.extracted_criteria = {**clean, "_list_mode": "interested"}
    session.matched_record_ids = interested_ids
    session.current_match_index = 0
    session.state = "presenting"
    session.info_step = 7
    return await _show_property(session, db, interested_ids[0])


async def _build_alternative_bedroom_pool(
    db: Session,
    criteria: dict,
    top_n: int,
    excluded_ids: set[str],
    raw_description: str,
    current_ids: list[str],
    seen_source_urls: set[str] | None = None,
) -> tuple[list[str], list[int]]:
    """Find same-location properties with bedroom counts different from requested bedrooms."""
    from app.services.matchmaking import _extract_bedroom_counts

    location = (criteria.get("location") or "").strip()
    wanted_beds = criteria.get("bedrooms")
    if not location or not wanted_beds:
        return [], []

    base_criteria = {k: v for k, v in criteria.items() if k != "bedrooms"}
    candidates = await find_matches(
        db,
        base_criteria,
        top_n=max(top_n * 10, 40),
        excluded_ids=excluded_ids,
        raw_description=raw_description,
    )

    current_set = set(current_ids)
    alt_ids: list[str] = []
    alt_bed_values: set[int] = set()
    for rid in candidates:
        if rid in current_set:
            continue
        if seen_source_urls:
            src = _get_record_source_url(db, rid)
            if src and src in seen_source_urls:
                continue
        data = get_record_data(db, rid) or {}
        counts = _extract_bedroom_counts(data)
        if not counts or wanted_beds in counts:
            continue
        alt_ids.append(rid)
        for c in counts:
            if c != wanted_beds:
                alt_bed_values.add(c)

    return alt_ids, sorted(alt_bed_values)


# â”€â”€ Interaction tracking helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _upsert_interaction(site_user_id, record_id: str, db: Session, **fields) -> None:
    """Create or update a UserPropertyInteraction row."""
    try:
        from app.models.user_property_interaction import UserPropertyInteraction
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        rid = UUID(record_id)
        row = db.query(UserPropertyInteraction).filter_by(
            site_user_id=uid, record_id=rid
        ).first()
        if not row:
            row = UserPropertyInteraction(site_user_id=uid, record_id=rid)
            db.add(row)
        for k, v in fields.items():
            setattr(row, k, v)
        db.flush()
    except Exception as e:
        logger.warning(f"[tracking] could not upsert interaction: {e}")


def _seen_in_chat_before(site_user_id, record_id: str, db: Session) -> bool | None:
    """Return whether the user had already seen this record before current display."""
    try:
        from app.models.user_property_interaction import UserPropertyInteraction
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        rid = UUID(record_id)
        row = (
            db.query(UserPropertyInteraction.seen_in_chat)
            .filter(
                UserPropertyInteraction.site_user_id == uid,
                UserPropertyInteraction.record_id == rid,
            )
            .first()
        )
        if not row:
            return False
        return bool(row[0])
    except Exception as e:
        logger.warning(f"[tracking] could not inspect seen flag: {e}")
        return None


def _get_disliked_ids(site_user_id, db: Session) -> set[str]:
    """Return record IDs this user has rated 1-2 stars (explicit dislike)."""
    try:
        from app.models.user_property_interaction import UserPropertyInteraction
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        rows = db.query(UserPropertyInteraction).filter(
            UserPropertyInteraction.site_user_id == uid,
            UserPropertyInteraction.rating <= 2,
        ).all()
        return {str(r.record_id) for r in rows}
    except Exception as e:
        logger.warning(f"[tracking] could not fetch disliked ids: {e}")
        return set()


def _get_user_rating(site_user_id, record_id: str, db: Session) -> int | None:
    """Return the user's star rating for a property, or None if unrated."""
    try:
        from app.models.user_property_interaction import UserPropertyInteraction
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        rid = UUID(record_id)
        row = (
            db.query(UserPropertyInteraction.rating)
            .filter(
                UserPropertyInteraction.site_user_id == uid,
                UserPropertyInteraction.record_id == rid,
            )
            .first()
        )
        return int(row[0]) if row and row[0] is not None else None
    except Exception as e:
        logger.warning(f"[tracking] could not fetch user rating: {e}")
        return None


def _get_properties_by_rating_filter(
    site_user_id, db: Session,
    min_rating: int | None = None,
    max_rating: int | None = None,
) -> list[str]:
    """Return record IDs filtered by the user's star rating, ordered by rating desc."""
    try:
        from app.models.user_property_interaction import UserPropertyInteraction
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        q = db.query(UserPropertyInteraction).filter(
            UserPropertyInteraction.site_user_id == uid,
            UserPropertyInteraction.rating.isnot(None),
        )
        if min_rating is not None:
            q = q.filter(UserPropertyInteraction.rating >= min_rating)
        if max_rating is not None:
            q = q.filter(UserPropertyInteraction.rating <= max_rating)
        rows = q.order_by(UserPropertyInteraction.rating.desc()).all()
        return [str(r.record_id) for r in rows]
    except Exception as e:
        logger.warning(f"[tracking] could not fetch properties by rating: {e}")
        return []


def _get_properties_without_price(db: Session) -> list[str]:
    """Return record IDs (propiedades) that have no known price."""
    try:
        from app.models.propiedad import Propiedad
        rows = (
            db.query(Propiedad.id)
            .filter(
                (Propiedad.precio_desde.is_(None)) | (Propiedad.precio_desde == "")
            )
            .order_by(Propiedad.scraped_at.desc())
            .limit(50)
            .all()
        )
        return [str(r[0]) for r in rows]
    except Exception as e:
        logger.warning(f"[tracking] could not fetch properties without price: {e}")
        return []


_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)

_HIGH_RATING_KW = [
    "muchas estrellas", "alta calificacion", "alta puntuacion", "bien calificad",
    "mejor calificad", "calificacion alta", "buena calificacion", "alta nota",
    "altas estrellas", "estrellas altas", "muchos puntos", "estrellas altas",
]
_LOW_RATING_KW = [
    "pocas estrellas", "baja calificacion", "pocos puntos", "mala calificacion",
    "baja nota", "estrellas bajas", "bajas estrellas", "mal calificad",
]
_NO_PRICE_KW = [
    "sin precio", "precio desconocido", "no tiene precio", "precio no disponible",
    "precio no se conoce", "sin saber el precio", "precio oculto", "sin precio conocido",
]


def _detect_exact_filter_request(text: str) -> dict | None:
    """Detect explicit property filter requests.

    Returns one of:
      {"type": "by_id",     "record_id": str}
      {"type": "by_rating", "min_rating": int, "max_rating": int, "label": str}
      {"type": "no_price"}
      None
    """
    # UUID detection — highest priority
    m = _UUID_RE.search(text)
    if m:
        return {"type": "by_id", "record_id": m.group(0)}

    n = _normalize_text(text)

    # Exact N stars: "califiqué con 3 estrellas", "con 4 estrellas", etc.
    exact = re.search(
        r"(?:califiq\w*|con|de|puntuad\w*)\s+(?:con\s+)?(\d)\s*estrell", n
    )
    if exact:
        r = int(exact.group(1))
        if 1 <= r <= 5:
            label = f"{r} estrella{'s' if r != 1 else ''}"
            return {"type": "by_rating", "min_rating": r, "max_rating": r, "label": label}

    # High rating
    if any(kw in n for kw in _HIGH_RATING_KW):
        return {"type": "by_rating", "min_rating": 4, "max_rating": 5, "label": "alta calificación (4-5 estrellas)"}

    # Low rating
    if any(kw in n for kw in _LOW_RATING_KW):
        return {"type": "by_rating", "min_rating": 1, "max_rating": 2, "label": "baja calificación (1-2 estrellas)"}

    # Generic "propiedades que califiqué" — any rating
    if re.search(r"califiq\w+|calificad\w+|que\s+puntue\w*", n) and "estrell" in n:
        return {"type": "by_rating", "min_rating": 1, "max_rating": 5, "label": "calificadas"}

    # No known price
    if any(kw in n for kw in _NO_PRICE_KW):
        return {"type": "no_price"}

    return None


def _safe_flush(db: Session, *objects) -> None:
    """Add objects and flush inside a savepoint so a failure doesn't corrupt the outer session."""
    sp = db.begin_nested()
    try:
        for obj in objects:
            db.add(obj)
        db.flush()
        sp.commit()
    except Exception:
        sp.rollback()
        raise


def _save_search_history(site_user_id, description: str, criteria: dict, db: Session) -> None:
    try:
        from app.models.search_history import SearchHistory
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        h = SearchHistory(
            site_user_id=uid,
            query=description[:500] if description else None,
            location=criteria.get("location") or None,
            project_id=None,
            source="chatbot",
        )
        _safe_flush(db, h)
    except Exception as e:
        logger.warning(f"[history] could not save search history: {e}")


def _save_preferences(
    site_user_id,
    criteria: dict,
    description: str,
    db: Session,
    extra_context: dict | None = None,
) -> None:
    """Upsert user preferences from extracted criteria."""
    try:
        from app.models.user_preference import UserPreference
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        sp = db.begin_nested()
        try:
            pref = db.query(UserPreference).filter_by(site_user_id=uid).first()
            if not pref:
                pref = UserPreference(site_user_id=uid)
                db.add(pref)
            if criteria.get("location"):
                pref.location = criteria.get("location")
            if criteria.get("bedrooms") is not None:
                pref.bedrooms = criteria.get("bedrooms")
            if criteria.get("min_price") is not None:
                pref.min_price = criteria.get("min_price")
            if criteria.get("max_price") is not None:
                pref.max_price = criteria.get("max_price")
            if criteria.get("features"):
                pref.features = criteria.get("features")
            if criteria.get("keywords"):
                pref.keywords = criteria.get("keywords")
            pref.raw_description = description
            pref.preferences_v2 = build_preferences_v2_from_criteria(criteria, pref.preferences_v2)
            pref.context = merge_consolidated_context(pref.context, criteria, description, extra_context)
            db.flush()
            sp.commit()
        except Exception:
            sp.rollback()
            raise
    except Exception as e:
        logger.warning(f"[prefs] could not save preferences: {e}")


def _track_behavior_signal(site_user_id, signal_key: str, record_id: str | None, db: Session) -> None:
    if not record_id:
        return
    try:
        from app.models.user_preference import UserPreference
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        pref = db.query(UserPreference).filter_by(site_user_id=uid).first()
        if not pref:
            return

        current_context = pref.context if isinstance(pref.context, dict) else {}
        behavior = dict(current_context.get("behavior_signals") or {})
        bucket = list(behavior.get(signal_key) or [])
        if record_id not in bucket:
            bucket.append(record_id)
        behavior[signal_key] = bucket[-100:]
        pref.context = merge_consolidated_context(
            current_context,
            {},
            pref.raw_description or "",
            extra_context={"behavior_signals": behavior},
        )
        db.flush()
    except Exception as e:
        logger.warning(f"[prefs] could not track behavior signal {signal_key}: {e}")


def _load_saved_preferences(site_user_id, db: Session) -> tuple[dict, str, dict, str]:
    try:
        from app.models.user_preference import UserPreference
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        pref = db.query(UserPreference).filter_by(site_user_id=uid).first()
        if not pref:
            return {}, "", default_preferences_v2(), ""

        context = pref.context if isinstance(pref.context, dict) else {}
        if isinstance(pref.preferences_v2, dict) and pref.preferences_v2:
            criteria = criteria_from_preferences_v2(pref.preferences_v2, context)
            summary = summarize_preferences_v2(pref.preferences_v2, context)
            description = (
                (context.get("conversation_memory") or {}).get("last_search_description")
                if isinstance(context.get("conversation_memory"), dict)
                else None
            ) or pref.raw_description or ""
            clean = {k: v for k, v in criteria.items() if v not in (None, "", []) and v != {}}
            return clean, description, pref.preferences_v2, summary

        # Backward compatibility path for legacy rows.
        legacy_criteria = {
            "location": pref.location,
            "bedrooms": pref.bedrooms,
            "min_price": pref.min_price,
            "max_price": pref.max_price,
            "features": pref.features or [],
            "keywords": pref.keywords or [],
        }
        legacy_clean = {
            k: v for k, v in legacy_criteria.items()
            if v not in (None, "", []) and v != {}
        }
        pref_v2 = build_preferences_v2_from_criteria(legacy_clean, None)
        summary = summarize_preferences_v2(pref_v2, context)
        return legacy_clean, pref.raw_description or "", pref_v2, summary
    except Exception as e:
        logger.warning(f"[prefs] could not load preferences: {e}")
        return {}, "", default_preferences_v2(), ""


async def _attach_quick_replies(
    session: WebChatSession,
    result: dict,
    user_message: str = "",
) -> dict:
    try:
        from app.services.claude_service import generate_quick_replies
        options = await generate_quick_replies(
            assistant_message=str(result.get("message") or ""),
            state=str(result.get("state") or session.state or "collecting_info"),
            has_card=bool(result.get("card")),
            user_message=user_message or "",
            has_saved_criteria=_has_actionable_criteria(session.extracted_criteria),
        )
        result["quick_replies"] = options or []
    except Exception as e:
        logger.warning(f"[quick_replies] could not generate options: {e}")
        result["quick_replies"] = []
    return result


# â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def create_session(db: Session, site_user=None) -> tuple[WebChatSession, dict]:
    session = WebChatSession()
    rehydrated = False
    context_summary = ""

    if site_user:
        active_sessions = (
            db.query(WebChatSession)
            .filter(
                WebChatSession.site_user_id == site_user.id,
                WebChatSession.is_active.is_(True),
            )
            .all()
        )
        for old_session in active_sessions:
            old_session.is_active = False
            old_session.inactivated_at = datetime.now(timezone.utc)
            old_session.state = "inactivo"

        session.site_user_id = site_user.id
        session.email = site_user.email
        session.name = site_user.name
        session.country = site_user.country
        session.phone = site_user.phone
        session.is_active = True

    session.info_step = 4
    greeting = _GREETING

    if site_user:
        saved_criteria, saved_desc, pref_v2, summary = _load_saved_preferences(site_user.id, db)
        if _has_actionable_criteria(saved_criteria):
            session.extracted_criteria = saved_criteria
            session.ideal_description = saved_desc or session.ideal_description
            session.info_step = 8
            rehydrated = True
            context_summary = summary
            user_name = site_user.name or "de nuevo"
            greeting = (
                f"Hola {user_name}. Rehidrate tu contexto anterior: {summary}.\n"
                "¿Cómo quieres continuar?\n"
                "1. Ver propiedades nuevas o que aun no has visto.\n"
                "2. Volver a ver propiedades que ya revisaste.\n"
                "3. Ajustar tu búsqueda."
            )
        elif isinstance(pref_v2, dict):
            context_summary = summarize_preferences_v2(pref_v2, {})

    db.add(session)
    db.flush()
    db.add(WebChatMessage(session_id=session.id, role="assistant", content=greeting))
    db.commit()
    db.refresh(session)
    initial = _text(greeting)
    initial["state"] = session.state
    initial["rehydrated"] = rehydrated
    initial["context_summary"] = context_summary
    initial = await _attach_quick_replies(session, initial)
    return session, initial


async def handle_message(session_id: str, user_content: str, db: Session) -> dict:
    try:
        session = db.query(WebChatSession).filter(WebChatSession.id == UUID(session_id)).first()
        if not session:
            return _text("Sesión no encontrada.")
        if session.site_user_id and not session.is_active:
            return _text(
                "Esta sesión ya no está activa porque abriste un chat nuevo. "
                "Continúa en tu sesión más reciente."
            )

        text = user_content.strip()
        db.add(WebChatMessage(session_id=session.id, role="user", content=text))

        result = await _process(session, text, db)
        result.setdefault("state", session.state)
        result = await _attach_quick_replies(session, result, text)

        db.add(WebChatMessage(session_id=session.id, role="assistant", content=result["message"]))
        db.commit()
        return result
    except Exception as e:
        logger.error("handle_message unhandled error: %s", e, exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
        return _text("Ocurrió un error procesando tu mensaje. Por favor, intenta nuevamente.")


def _wants_next_property(text: str) -> bool:
    t = _normalize_text(text)
    return any(k in t for k in ["siguiente", "ver siguiente", "otra", "ver otra", "no me convence", "next", "skip"])


def _is_property_detail_request(text: str) -> bool:
    t = _normalize_text(text)
    patterns = [
        "detalle",
        "detalles",
        "mas info",
        "mas informacion",
        "informacion",
        "precio",
        "m2",
        "metros",
        "bano",
        "dormitorio",
        "habitacion",
        "direccion",
    ]
    return any(p in t for p in patterns)


def _rate_current_property(session: WebChatSession, rating: int, db: Session) -> str:
    if rating and session.site_user_id and session.matched_record_ids:
        idx = session.current_match_index
        if idx < len(session.matched_record_ids):
            record_id = session.matched_record_ids[idx]
            _upsert_interaction(
                session.site_user_id,
                record_id,
                db,
                rating=rating,
                rated_at=datetime.now(timezone.utc),
            )
            _track_behavior_signal(session.site_user_id, "rated_record_ids", record_id, db)
            if rating <= 2:
                _track_behavior_signal(session.site_user_id, "discarded_record_ids", record_id, db)
    return _rating_feedback(rating)


def _rating_followup_question(rating: int) -> str:
    if rating <= 2:
        return (
            "¿Qué no te convence de esta propiedad? "
            "Cuéntame (precio, tamaño, ubicación, amenidades...) para afinar mejor la búsqueda. "
            "O escribe «siguiente» para continuar."
        )
    if rating == 3:
        return (
            "¿Qué le cambiarías? Ayúdame a entender qué mejorarías "
            "(tamaño, precio, zona, amenidades...). "
            "O escribe «siguiente» para seguir viendo propiedades."
        )
    return (
        "¿Qué es lo que más te gustó? Así busco propiedades más parecidas para ti. "
        "O escribe «siguiente» si prefieres ver otra opción."
    )


def _rate_and_ask_feedback(session: WebChatSession, rating: int, db: Session) -> str:
    """Save rating, arm the pending-feedback state, return the follow-up question."""
    record_id: str | None = None
    if rating and session.site_user_id and session.matched_record_ids:
        idx = session.current_match_index
        if idx < len(session.matched_record_ids):
            record_id = session.matched_record_ids[idx]
            _upsert_interaction(
                session.site_user_id,
                record_id,
                db,
                rating=rating,
                rated_at=datetime.now(timezone.utc),
            )
            _track_behavior_signal(session.site_user_id, "rated_record_ids", record_id, db)
            if rating <= 2:
                _track_behavior_signal(session.site_user_id, "discarded_record_ids", record_id, db)

    criteria = dict(session.extracted_criteria or {})
    criteria["_pending_rating_feedback"] = {
        "rating": rating,
        "record_id": str(record_id) if record_id else None,
    }
    session.extracted_criteria = criteria
    session.info_step = 20
    return _rating_followup_question(rating)


async def _process_rating_feedback(session: WebChatSession, text: str, db: Session) -> dict:
    """Handle the user's response to the post-rating follow-up question (info_step == 20)."""
    ctx = dict(session.extracted_criteria or {})
    pending = ctx.get("_pending_rating_feedback") or {}
    rating: int = pending.get("rating") or 3
    record_id: str | None = pending.get("record_id")

    t = _normalize_text(text)

    # User wants to skip feedback — just move to the next property
    skip_signals = ["siguiente", "skip", "continuar", "otra", "no se", "no sé", "da igual", "omitir"]
    if _wants_next_property(text) or any(s in t for s in skip_signals) or len(text.strip()) <= 2:
        ctx.pop("_pending_rating_feedback", None)
        session.extracted_criteria = ctx
        session.info_step = 7
        return await _next_property(session, db)

    # Fetch property data for context
    property_data: dict = {}
    if record_id:
        from app.services.matchmaking import get_record_data
        property_data = get_record_data(db, record_id) or {}

    # Extract preference adjustments from the feedback via Claude
    adjustments: dict = {}
    try:
        from app.services.claude_service import extract_rating_feedback_criteria
        adjustments = await extract_rating_feedback_criteria(text, rating, property_data)
    except Exception as exc:
        logger.warning("[feedback] criteria extraction failed: %s", exc)

    # Merge adjustments into the user's persistent preferences
    _MEANINGFUL_ADJ_KEYS = {"location", "bedrooms", "area_min", "area_max",
                             "min_price", "max_price", "common_areas", "nearby_zones", "keywords"}
    has_meaningful = any(adjustments.get(k) for k in _MEANINGFUL_ADJ_KEYS)
    confirmation_parts: list[str] = []
    if has_meaningful and session.site_user_id:
        _save_preferences(session.site_user_id, adjustments, "", db)
        if adjustments.get("max_price"):
            confirmation_parts.append(f"presupuesto máximo {int(adjustments['max_price']):,}")
        if adjustments.get("min_price"):
            confirmation_parts.append(f"presupuesto mínimo {int(adjustments['min_price']):,}")
        if adjustments.get("area_min"):
            confirmation_parts.append(f"mínimo {int(adjustments['area_min'])} m²")
        if adjustments.get("area_max"):
            confirmation_parts.append(f"máximo {int(adjustments['area_max'])} m²")
        if adjustments.get("bedrooms"):
            confirmation_parts.append(f"{adjustments['bedrooms']} dormitorios")
        if adjustments.get("common_areas"):
            confirmation_parts.append(f"con {', '.join(adjustments['common_areas'][:2])}")
        if adjustments.get("nearby_zones"):
            confirmation_parts.append(f"cerca de {', '.join(adjustments['nearby_zones'][:2])}")
        if adjustments.get("location"):
            confirmation_parts.append(f"en {adjustments['location']}")
        if adjustments.get("keywords"):
            confirmation_parts.append(f"características: {', '.join(adjustments['keywords'][:2])}")

    # Clear pending state and return to normal presenting flow
    ctx.pop("_pending_rating_feedback", None)
    session.extracted_criteria = ctx
    session.info_step = 7

    if confirmation_parts:
        msg = (
            f"Anotado: {', '.join(confirmation_parts)}. "
            "Tendré esto en cuenta para las siguientes recomendaciones. "
            "¿Quieres ver la siguiente propiedad?"
        )
    else:
        msg = "Gracias por el comentario, lo tendré en cuenta. ¿Seguimos buscando?"

    return _text(msg)


async def _handle_contact_capture_step(session: WebChatSession, user_text: str, db: Session) -> dict | None:
    step = session.info_step
    ctx = session.extracted_criteria or {}

    if step == 12:
        clean = _clean_criteria(ctx)
        lead = dict((ctx or {}).get("_lead") or {})
        lead = _hydrate_lead_from_db(session, lead, db)

        doc_ref = _extract_financial_capacity_doc(user_text)
        if not doc_ref:
            if _is_negative_message(user_text):
                return _text(
                    "Entiendo. Para continuar con la evaluacion del perfil necesito ese documento. "
                    "Cuando lo tengas, comparte el enlace del archivo."
                )
            return _text(
                "No pude identificar el documento de sustento financiero. "
                "Comparte un enlace valido (PDF/JPG/Drive) para registrarlo."
            )

        lead["financial_capacity_doc"] = doc_ref
        lead["requires_financial_capacity_doc"] = True
        session.extracted_criteria = {**clean, "_lead": lead}

        missing = _get_missing_lead_fields(lead)
        if missing:
            if not (lead.get("country_of_residence") or session.country or "").strip():
                session.info_step = 9
            else:
                session.info_step = 10
            session.state = "collecting_info"
            return _text(
                "Perfecto, ya registré tu sustento financiero. "
                + _build_contact_request_message(lead)
            )

        return _finalize_lead_request(session, clean, lead, db)

    if step == 9:
        country = user_text[:80]
        session.country = country
        if session.site_user_id:
            try:
                from app.models.site_user import SiteUser
                su = db.query(SiteUser).filter(SiteUser.id == session.site_user_id).first()
                if su and not su.country:
                    su.country = country
            except Exception as e:
                logger.warning(f"[lead] could not persist country: {e}")

        clean = _clean_criteria(ctx)
        lead = dict((ctx or {}).get("_lead") or {})
        lead["country_of_residence"] = country
        session.extracted_criteria = {**clean, "_lead": lead}
        session.info_step = 10
        return _text(_build_contact_request_message(lead))

    if step == 10:
        from app.services.claude_service import extract_contact_fields
        clean = _clean_criteria(ctx)
        lead = dict((ctx or {}).get("_lead") or {})
        lead = _hydrate_lead_from_db(session, lead, db)
        lead_country = lead.get("country_of_residence") or session.country

        ai_contact = await extract_contact_fields(user_text)
        ai_name = (ai_contact.get("full_name") or "").strip() or None
        ai_whatsapp = (ai_contact.get("whatsapp") or "").strip() or None
        ai_document = (ai_contact.get("document_number") or "").strip() or None

        doc_from_text = _extract_document(user_text)
        document = _normalize_document(ai_document) or doc_from_text or _normalize_document(lead.get("document_number"))
        if document and "peru" in _normalize_text(lead_country or ""):
            if document.isdigit() and not _looks_like_peru_dni(document):
                document = _normalize_document(lead.get("document_number"))
        whatsapp = (
            _normalize_whatsapp(ai_whatsapp, country=lead_country, document=document)
            or _extract_whatsapp(user_text, country=lead_country, document=document)
            or _normalize_whatsapp(lead.get("whatsapp"), country=lead_country, document=document)
        )
        full_name = ai_name or _extract_full_name(user_text) or lead.get("full_name")

        if full_name:
            lead["full_name"] = full_name
        if whatsapp:
            lead["whatsapp"] = whatsapp
        elif lead.get("whatsapp"):
            previous_phone = _normalize_whatsapp(
                lead.get("whatsapp"),
                country=lead_country,
                document=document,
            )
            if previous_phone:
                lead["whatsapp"] = previous_phone
            else:
                lead.pop("whatsapp", None)
        if document:
            lead["document_number"] = document

        missing = _get_missing_lead_fields(lead)
        session.extracted_criteria = {**clean, "_lead": lead}
        if missing:
            return _text("Gracias. " + _build_contact_request_message(lead))
        return _finalize_lead_request(session, clean, lead, db)

    return None


def _build_intent_runtime(session: WebChatSession, user_text: str, db: Session, step: int) -> IntentRuntime:
    async def _start_search_action(description: str) -> dict:
        return await _start_search(session, description, db)

    async def _show_interested_action() -> dict:
        return await _show_interested_properties(session, db)

    async def _show_property_action(record_id: str) -> dict:
        return await _show_property(session, db, record_id)

    async def _next_property_action() -> dict:
        return await _next_property(session, db)

    async def _contact_capture_action() -> dict | None:
        return await _handle_contact_capture_step(session, user_text, db)

    async def _financial_doc_capture_action() -> dict | None:
        return await _handle_contact_capture_step(session, user_text, db)

    async def _contextual_fallback_action() -> dict:
        from app.services.claude_service import generate_contextual_response
        summary = _summarize_preferences(_clean_criteria(session.extracted_criteria))
        text = await generate_contextual_response(
            user_text=user_text,
            state=session.state,
            step=session.info_step,
            context_summary=summary,
        )
        return _text(text)

    helpers = {
        "text_response": _text,
        "fallback_out_of_scope": _fallback_out_of_scope,
        "fallback_not_understood": _fallback_not_understood,
        "normalize_text": _normalize_text,
        "is_scope_message": _is_scope_message,
        "is_new_unseen_request": _is_new_unseen_request,
        "is_viewed_request": _is_viewed_request,
        "is_interested_list_request": _is_interested_list_request,
        "is_adjust_search_intent": _is_adjust_search_intent,
        "is_generic_adjust_request": _is_generic_adjust_request,
        "is_mark_current_property_interest": _is_mark_current_property_interest,
        "looks_like_search_update": _looks_like_search_update,
        "is_affirmative_message": _is_affirmative_message,
        "is_negative_message": _is_negative_message,
        "extract_rating_from_text": _extract_rating_from_text,
        "wants_next_property": _wants_next_property,
        "is_property_detail_request": _is_property_detail_request,
        "clean_criteria": _clean_criteria,
        "has_actionable_criteria": _has_actionable_criteria,
        "summarize_preferences": _summarize_preferences,
        "get_exhausted_revisit_ids": _get_exhausted_revisit_ids,
        "get_viewed_ranked_ids": lambda site_user_id: _get_viewed_ranked_ids(site_user_id, db),
        "rate_current_property": lambda rating: _rate_current_property(session, rating, db),
        "rate_and_ask_feedback": lambda rating: _rate_and_ask_feedback(session, rating, db),
        "mark_interest": lambda text: _do_interested(session, text, db),
        "start_search": _start_search_action,
        "show_interested_properties": _show_interested_action,
        "show_property_by_id": _show_property_action,
        "next_property": _next_property_action,
        "handle_contact_capture_step": _contact_capture_action,
        "handle_financial_document_step": _financial_doc_capture_action,
        "looks_like_financial_doc_text": _looks_like_financial_doc_text,
        "contextual_fallback_response": _contextual_fallback_action,
        "detect_exact_filter": _detect_exact_filter_request,
        "get_properties_by_rating_filter": lambda uid, mn, mx: _get_properties_by_rating_filter(uid, db, mn, mx),
        "get_properties_without_price": lambda: _get_properties_without_price(db),
    }
    return IntentRuntime(
        session=session,
        db=db,
        user_text=user_text,
        state=session.state,
        step=step,
        ctx=session.extracted_criteria or {},
        helpers=helpers,
    )


# â”€â”€ FSM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _process(session: WebChatSession, text: str, db: Session) -> dict:
    if session.state == "collecting_info":
        return await _collect_info(session, text, db)
    if session.state == "presenting":
        return await _handle_presenting(session, text, db)
    if session.state == "contact_requested":
        runtime = _build_intent_runtime(session, text, db, session.info_step)
        candidates = candidate_intents_for_state("contact_requested", session.info_step)
        intent_response = await dispatch_intents(runtime, candidates)
        if intent_response is not None:
            return intent_response
        return _text("Tu solicitud ya fue registrada. Un asesor se pondra en contacto contigo muy pronto.")
    return _text("No entendi tu mensaje. Puedes intentarlo de nuevo?")


async def _collect_info(session: WebChatSession, text: str, db: Session) -> dict:
    step = session.info_step
    user_text = (text or "").strip()
    ctx = session.extracted_criteria or {}

    # Compatibility with old sessions that started by asking identity fields.
    if step in {0, 1, 2, 3}:
        step = 4
        session.info_step = 4

    runtime = _build_intent_runtime(session, user_text, db, step)
    candidates = candidate_intents_for_state("collecting_info", step)
    intent_response = await dispatch_intents(runtime, candidates)
    if intent_response is not None:
        return intent_response

    if step == 4:
        if _is_generic_adjust_request(user_text):
            session.info_step = 11
            return _text(
                "Perfecto. Indícame los nuevos parámetros para ajustar la búsqueda "
                "(por ejemplo: zona/ciudad, dormitorios o presupuesto)."
            )

        exhausted_revisit_ids = _get_exhausted_revisit_ids(ctx)
        if exhausted_revisit_ids and _looks_like_search_update(user_text):
            clean = _clean_criteria(ctx)
            if _is_new_unseen_request(user_text):
                session.extracted_criteria = {**clean, "_result_mode": "new_unseen"}
            else:
                session.extracted_criteria = clean
            session.info_step = 5
            return await _start_search(session, user_text, db)
        if exhausted_revisit_ids and _is_viewed_request(user_text):
            session.matched_record_ids = exhausted_revisit_ids
            session.current_match_index = 0
            session.state = "presenting"
            session.info_step = 7
            return await _show_property(session, db, exhausted_revisit_ids[0])
        if exhausted_revisit_ids and _is_adjust_search_intent(user_text):
            return _text(
                "Perfecto. Dime qué quieres ajustar (zona, dormitorios, presupuesto o características) "
                "y busco nuevas opciones."
            )

        if session.site_user_id and _is_interested_list_request(user_text):
            return await _show_interested_properties(session, db)

        if session.site_user_id and _is_viewed_request(user_text):
            viewed_ids = _get_viewed_ranked_ids(session.site_user_id, db)
            if not viewed_ids:
                return _text(
                    "Aún no tienes propiedades vistas registradas. "
                    "Si quieres, te muestro propiedades nuevas con tus preferencias actuales."
                )
            session.matched_record_ids = viewed_ids
            session.current_match_index = 0
            session.state = "presenting"
            session.info_step = 7
            return await _show_property(session, db, viewed_ids[0])

        if not _is_scope_message(user_text):
            return _fallback_out_of_scope()

        if session.site_user_id and _is_new_unseen_request(user_text):
            clean = _clean_criteria(ctx)
            session.extracted_criteria = {**clean, "_result_mode": "new_unseen"}
            session.info_step = 5
            seed = user_text if _looks_like_search_update(user_text) else (session.ideal_description or user_text)
            return await _start_search(session, seed, db)

        session.ideal_description = user_text
        session.info_step = 5
        return await _start_search(session, user_text, db)

    if step == 8:
        current_criteria = _clean_criteria(session.extracted_criteria)
        has_saved_criteria = _has_actionable_criteria(current_criteria)
        exhausted_revisit_ids = _get_exhausted_revisit_ids(ctx)

        if _is_generic_adjust_request(user_text):
            session.info_step = 11
            return _text(
                "Perfecto. Indícame los cambios que quieres aplicar "
                "(zona/ciudad, dormitorios, presupuesto, etc.)."
            )

        if exhausted_revisit_ids and _looks_like_search_update(user_text):
            if _is_new_unseen_request(user_text):
                session.extracted_criteria = {**current_criteria, "_result_mode": "new_unseen"}
            else:
                session.extracted_criteria = current_criteria
            session.info_step = 5
            return await _start_search(session, user_text, db)
        if exhausted_revisit_ids and _is_viewed_request(user_text):
            session.matched_record_ids = exhausted_revisit_ids
            session.current_match_index = 0
            session.state = "presenting"
            session.info_step = 7
            return await _show_property(session, db, exhausted_revisit_ids[0])
        if exhausted_revisit_ids and _is_adjust_search_intent(user_text):
            session.info_step = 4
            return _text(
                "Perfecto. Dime qué quieres ajustar (zona, dormitorios, presupuesto o características) "
                "y busco nuevas opciones."
            )

        if session.site_user_id and _is_interested_list_request(user_text):
            return await _show_interested_properties(session, db)

        if session.site_user_id and _is_viewed_request(user_text):
            viewed_ids = _get_viewed_ranked_ids(session.site_user_id, db)
            if not viewed_ids:
                return _text("Aún no tengo propiedades vistas para mostrarte. ¿Buscamos opciones nuevas?")
            session.matched_record_ids = viewed_ids
            session.current_match_index = 0
            session.state = "presenting"
            session.info_step = 7
            return await _show_property(session, db, viewed_ids[0])

        if session.site_user_id and _is_new_unseen_request(user_text):
            session.extracted_criteria = {**current_criteria, "_result_mode": "new_unseen"}
            session.info_step = 5
            seed = user_text if _looks_like_search_update(user_text) else (session.ideal_description or user_text)
            return await _start_search(session, seed, db)

        if _looks_like_search_update(user_text):
            session.info_step = 5
            return await _start_search(session, user_text, db)

        if _is_affirmative_message(user_text):
            if has_saved_criteria:
                session.info_step = 5
                return await _start_search(session, session.ideal_description or user_text, db)
            session.info_step = 4
            return _text("Perfecto. Cuéntame qué estás buscando exactamente para iniciar la búsqueda.")

        if _is_negative_message(user_text):
            session.info_step = 4
            return _text("Listo. Cuando quieras, dime qué propiedad buscas y arrancamos.")

        summary = _summarize_preferences(current_criteria if has_saved_criteria else {})
        if has_saved_criteria:
            return _text(
                f"Si quieres, busco con tus preferencias ({summary}). "
                "También puedes responder 1 (nuevas/no vistas) o 2 (vistas)."
            )
        return _text("¿Quieres que empecemos una búsqueda? Puedes contarme zona, dormitorios y presupuesto.")

    if step == 6:
        if _is_generic_adjust_request(user_text):
            session.matched_record_ids = []
            session.current_match_index = 0
            session.info_step = 11
            return _text(
                "Perfecto. Dime qué parámetros quieres cambiar y hago el ajuste."
            )

        if _is_affirmative_message(user_text) and session.matched_record_ids:
            session.state = "presenting"
            session.info_step = 7
            return await _show_property(session, db, session.matched_record_ids[0])

        if _looks_like_search_update(user_text):
            session.matched_record_ids = []
            session.current_match_index = 0
            session.info_step = 5
            return await _start_search(session, user_text, db)

        session.matched_record_ids = []
        session.current_match_index = 0
        session.info_step = 4
        return _text(
            "Entendido. Mantendré los filtros actuales. "
            "Si quieres, dime qué ajustamos (zona, dormitorios, presupuesto)."
        )

    if step == 11:
        if not user_text:
            return _text(
                "Te leo. Compárteme los nuevos parámetros para ajustar la búsqueda "
                "(zona/ciudad, dormitorios, presupuesto, etc.)."
            )
        if _is_generic_adjust_request(user_text) or _is_affirmative_message(user_text) or _is_negative_message(user_text):
            return _text(
                "Perfecto, quedo atento. Escríbeme los parámetros concretos que quieres ajustar "
                "(por ejemplo: 'zona Arequipa, 3 dormitorios, hasta 450000')."
            )
        session.info_step = 5
        return await _start_search(session, user_text, db)

    if step == 9:
        country = user_text[:80]
        session.country = country
        if session.site_user_id:
            try:
                from app.models.site_user import SiteUser
                su = db.query(SiteUser).filter(SiteUser.id == session.site_user_id).first()
                if su and not su.country:
                    su.country = country
            except Exception as e:
                logger.warning(f"[lead] could not persist country: {e}")

        clean = _clean_criteria(ctx)
        lead = dict((ctx or {}).get("_lead") or {})
        lead["country_of_residence"] = country
        session.extracted_criteria = {**clean, "_lead": lead}
        session.info_step = 10
        return _text(_build_contact_request_message(lead))

    if step == 10:
        from app.services.claude_service import extract_contact_fields
        clean = _clean_criteria(ctx)
        lead = dict((ctx or {}).get("_lead") or {})
        lead = _hydrate_lead_from_db(session, lead, db)
        lead_country = lead.get("country_of_residence") or session.country

        ai_contact = await extract_contact_fields(user_text)
        ai_name = (ai_contact.get("full_name") or "").strip() or None
        ai_whatsapp = (ai_contact.get("whatsapp") or "").strip() or None
        ai_document = (ai_contact.get("document_number") or "").strip() or None

        doc_from_text = _extract_document(user_text)
        document = _normalize_document(ai_document) or doc_from_text or _normalize_document(lead.get("document_number"))
        if document and "peru" in _normalize_text(lead_country or ""):
            if document.isdigit() and not _looks_like_peru_dni(document):
                document = _normalize_document(lead.get("document_number"))
        whatsapp = (
            _normalize_whatsapp(ai_whatsapp, country=lead_country, document=document)
            or _extract_whatsapp(user_text, country=lead_country, document=document)
            or _normalize_whatsapp(lead.get("whatsapp"), country=lead_country, document=document)
        )
        full_name = ai_name or _extract_full_name(user_text) or lead.get("full_name")

        if full_name:
            lead["full_name"] = full_name
        if whatsapp:
            lead["whatsapp"] = whatsapp
        elif lead.get("whatsapp"):
            previous_phone = _normalize_whatsapp(
                lead.get("whatsapp"),
                country=lead_country,
                document=document,
            )
            if previous_phone:
                lead["whatsapp"] = previous_phone
            else:
                lead.pop("whatsapp", None)
        if document:
            lead["document_number"] = document

        missing = _get_missing_lead_fields(lead)

        session.extracted_criteria = {**clean, "_lead": lead}

        if missing:
            return _text("Gracias. " + _build_contact_request_message(lead))

        return _finalize_lead_request(session, clean, lead, db)

    return _fallback_not_understood()


async def _start_search(session: WebChatSession, description: str, db: Session) -> dict:
    prev_snap = _clean_criteria(session.extracted_criteria)
    is_adjustment = bool(prev_snap)
    result = await _run_search(session, description, db)
    if is_adjustment:
        from app.services.claude_service import generate_criteria_acknowledgment
        ack = await generate_criteria_acknowledgment(description)
        if result.get("message"):
            result = {**result, "message": f"{ack}\n\n{result['message']}"}
    return result


async def _run_search(session: WebChatSession, description: str, db: Session) -> dict:
    existing_mode = (session.extracted_criteria or {}).get("_result_mode")
    try:
        from app.services.claude_service import extract_criteria
        new_criteria = await extract_criteria(description)
    except Exception:
        new_criteria = {"keywords": description.split(), "location": ""}

    # Keep explicit bedroom intent from latest user message, especially corrections.
    explicit_beds = _extract_explicit_bedrooms(description)
    if explicit_beds:
        new_criteria["bedrooms"] = explicit_beds
    explicit_baths = _extract_explicit_bathrooms(description)
    if explicit_baths:
        new_criteria["bathrooms"] = explicit_baths
    area_min, area_max, area_exact = _extract_explicit_area_range(description)
    if area_exact is not None:
        new_criteria["area_exact"] = area_exact
    if area_min is not None:
        new_criteria["area_min"] = area_min
    if area_max is not None:
        new_criteria["area_max"] = area_max

    explicit_min_price, explicit_max_price = _extract_explicit_price_limits(description)
    if explicit_min_price is not None:
        new_criteria["min_price"] = explicit_min_price
    if explicit_max_price is not None:
        new_criteria["max_price"] = explicit_max_price
    if explicit_min_price is not None or explicit_max_price is not None:
        new_criteria["budget_mode"] = _extract_preference_mode(
            description,
            ["presupuesto", "precio", "soles", "dolares", "usd"],
            default="preferencia",
        )

    nearby_prefs = _extract_nearby_preferences(description)
    if nearby_prefs:
        new_criteria["features"] = _merge_unique_terms(list(new_criteria.get("features") or []), nearby_prefs)
        new_criteria["keywords"] = _merge_unique_terms(list(new_criteria.get("keywords") or []), nearby_prefs)
        cleaned_nearby = [re.sub(r"^cerca de\s+", "", t, flags=re.IGNORECASE).strip() for t in nearby_prefs]
        cleaned_nearby = [t for t in cleaned_nearby if t]
        new_criteria["nearby_zones"] = _merge_unique_terms(list(new_criteria.get("nearby_zones") or []), cleaned_nearby)

    common_areas = _extract_common_areas(description)
    if common_areas:
        new_criteria["common_areas"] = _merge_unique_terms(list(new_criteria.get("common_areas") or []), common_areas)
        new_criteria["features"] = _merge_unique_terms(list(new_criteria.get("features") or []), common_areas)
        new_criteria["keywords"] = _merge_unique_terms(list(new_criteria.get("keywords") or []), common_areas)

    # Mode inference for V2 preferences (obligatorio = hard filter, preferencia = ranking signal).
    if new_criteria.get("location"):
        new_criteria["location_mode"] = _extract_preference_mode(
            description,
            ["ubicacion", "zona", "distrito", "ciudad"],
            default="obligatorio",
        )
    if new_criteria.get("bedrooms"):
        new_criteria["bedrooms_mode"] = _extract_preference_mode(
            description,
            ["dormitorio", "dormitorios", "habitacion", "habitaciones", "cuartos"],
            default="obligatorio",
        )
    if new_criteria.get("bathrooms"):
        new_criteria["bathrooms_mode"] = _extract_preference_mode(
            description,
            ["bano", "banos", "bathroom", "aseo"],
            default="preferencia",
        )
    if new_criteria.get("area_exact") or new_criteria.get("area_min") or new_criteria.get("area_max"):
        new_criteria["area_mode"] = _extract_preference_mode(
            description,
            ["m2", "metro", "metros", "metraje", "superficie", "area"],
            default="preferencia",
        )
    if new_criteria.get("nearby_zones"):
        new_criteria["nearby_zones_mode"] = _extract_preference_mode(
            description,
            ["cerca", "alrededor", "cercano", "cercana"],
            default="preferencia",
        )
    if new_criteria.get("common_areas"):
        new_criteria["common_areas_mode"] = _extract_preference_mode(
            description,
            ["gimnasio", "piscina", "parrilla", "cowork", "juegos", "terraza", "pet"],
            default="preferencia",
        )

    # Merge: keep all previous criteria (strip internal _relax_* keys); new non-empty values override
    prev = _clean_criteria(session.extracted_criteria)
    merged: dict = {**prev}
    for k, v in new_criteria.items():
        if v is None or v == "" or (isinstance(v, list) and not v):
            continue
        merged[k] = v
    merged["features"] = _merge_unique_terms(list(prev.get("features") or []), list(merged.get("features") or []))
    merged["keywords"] = _merge_unique_terms(list(prev.get("keywords") or []), list(merged.get("keywords") or []))
    merged["nearby_zones"] = _merge_unique_terms(
        list(prev.get("nearby_zones") or []),
        list(merged.get("nearby_zones") or []),
    )
    merged["common_areas"] = _merge_unique_terms(
        list(prev.get("common_areas") or []),
        list(merged.get("common_areas") or []),
    )
    # Build full description context: original intent + current adjustment
    original = session.ideal_description or ""
    if original and description != original:
        full_desc = f"{original}\nAjuste del usuario: {description}"
    else:
        full_desc = description

    # Save preferences + search history for registered users
    if session.site_user_id:
        _save_preferences(
            session.site_user_id,
            merged,
            full_desc,
            db,
            extra_context={"conversation_memory": {"last_intent": "inicio_busqueda"}},
        )
        _save_search_history(session.site_user_id, description, merged, db)

    from app.models.chat_config import ChatConfig, DEFAULT_CONFIG_ID
    config = db.query(ChatConfig).filter(ChatConfig.id == DEFAULT_CONFIG_ID).first()
    top_n = config.top_n_properties if config else 3

    # Exclude properties this user has already disliked
    disliked_excluded: set[str] = set()
    excluded: set[str] = set()
    seen_source_urls: set[str] = set()
    viewed_ids_set: set[str] = set()
    if session.site_user_id:
        disliked_excluded = _get_disliked_ids(session.site_user_id, db)
        excluded = set(disliked_excluded)
        if existing_mode == "new_unseen":
            viewed_ids_set = set(_get_viewed_record_ids(session.site_user_id, db))
            excluded = excluded.union(viewed_ids_set)
            seen_source_urls = _get_viewed_source_urls(session.site_user_id, db)

    matches = await find_matches(db, merged, top_n, excluded_ids=excluded, raw_description=full_desc)
    if existing_mode == "new_unseen" and seen_source_urls:
        matches = _exclude_seen_sources(db, matches, seen_source_urls)

    # Build deferred alternatives (same location, different bedroom counts) to offer later.
    alt_ids: list[str] = []
    alt_bed_values: list[int] = []
    if matches and merged.get("location") and merged.get("bedrooms"):
        alt_ids, alt_bed_values = await _build_alternative_bedroom_pool(
            db,
            merged,
            top_n,
            excluded,
            full_desc,
            matches,
            seen_source_urls if existing_mode == "new_unseen" else None,
        )

    if alt_ids:
        session.extracted_criteria = {
            **merged,
            "_result_mode": existing_mode,
            "_deferred_alt_ids": alt_ids,
            "_deferred_alt_count": len(alt_ids),
            "_deferred_alt_beds": merged.get("bedrooms"),
            "_deferred_alt_loc": merged.get("location"),
            "_deferred_alt_values": alt_bed_values,
        }
    else:
        session.extracted_criteria = {**merged, "_result_mode": existing_mode} if existing_mode else merged

    session.matched_record_ids = matches
    session.current_match_index = 0
    session.state = "presenting"

    if not matches:
        loc = merged.get("location") or ""
        beds = merged.get("bedrooms")
        name_part = f", {session.name}" if session.name else ""

        if existing_mode == "new_unseen" and session.site_user_id:
            all_for_criteria = await find_matches(
                db,
                merged,
                max(top_n * 8, 20),
                excluded_ids=disliked_excluded,
                raw_description=full_desc,
            )
            if all_for_criteria:
                revisit_ids = [rid for rid in all_for_criteria if rid in viewed_ids_set]
                if not revisit_ids:
                    revisit_ids = all_for_criteria
                session.state = "collecting_info"
                session.info_step = 4
                session.extracted_criteria = {
                    **{k: v for k, v in merged.items() if not str(k).startswith("_")},
                    "_result_mode": existing_mode,
                    "_exhausted_unseen_ids": revisit_ids,
                }
                return _text(
                    "Ya viste todas las propiedades disponibles con esas caracteristicas. "
                    "Elige una opcion:\n"
                    "1. Ajustar mis parametros de busqueda.\n"
                    "2. Volver a ver las propiedades."
                )

        # â”€â”€ Relaxed search: find something close to offer proactively â”€â”€â”€â”€â”€â”€â”€â”€â”€
        relaxed_matches: list[str] = []
        offer_msg = ""
        relax_type = ""   # "loc_only" | "beds_only" | "no_beds" | "no_loc"

        if beds and loc:
            hab = "dormitorio" if beds == 1 else "dormitorios"
            # 1st try: same location, remove bedroom filter
            _c1 = {k: v for k, v in merged.items() if k != "bedrooms"}
            relaxed_matches = await find_matches(db, _c1, top_n * 2, excluded_ids=excluded, raw_description=full_desc)
            if existing_mode == "new_unseen" and seen_source_urls:
                relaxed_matches = _exclude_seen_sources(db, relaxed_matches, seen_source_urls)
            if relaxed_matches:
                relax_type = "loc_only"   # location has properties, just not matching beds
                offer_msg = (
                    f"No encontré coincidencias confirmadas de {beds} {hab} en {loc}, "
                    f"pero sí encontré {len(relaxed_matches)} opciones en {loc} con otra configuración "
                    "o sin dato claro de dormitorios. "
                    f"¿Te gustaría verlas{name_part}? 😊"
                )
            else:
                # 2nd try: same bedrooms, remove location filter
                _c2 = {k: v for k, v in merged.items() if k != "location"}
                relaxed_matches = await find_matches(db, _c2, top_n * 2, excluded_ids=excluded, raw_description=full_desc)
                if existing_mode == "new_unseen" and seen_source_urls:
                    relaxed_matches = _exclude_seen_sources(db, relaxed_matches, seen_source_urls)
                if relaxed_matches:
                    relax_type = "beds_only"   # location truly has nothing; beds available elsewhere
                    offer_msg = (
                        f"No encontré coincidencias confirmadas de {beds} {hab} en {loc}, "
                        f"pero sí tengo {len(relaxed_matches)} opciones en otras zonas. "
                        f"¿Te gustaría verlas{name_part}? 😊"
                    )
        elif beds:
            hab = "dormitorio" if beds == 1 else "dormitorios"
            _c = {k: v for k, v in merged.items() if k != "bedrooms"}
            relaxed_matches = await find_matches(db, _c, top_n * 2, excluded_ids=excluded, raw_description=full_desc)
            if existing_mode == "new_unseen" and seen_source_urls:
                relaxed_matches = _exclude_seen_sources(db, relaxed_matches, seen_source_urls)
            if relaxed_matches:
                relax_type = "no_beds"
                offer_msg = (
                    f"No encontré propiedades de {beds} {hab}, "
                    f"pero sí tenemos {len(relaxed_matches)} opciones que podrían interesarte. "
                    f"¿Te gustaría verlas{name_part}? 😊"
                )
        elif loc:
            _c = {k: v for k, v in merged.items() if k != "location"}
            relaxed_matches = await find_matches(db, _c, top_n * 2, excluded_ids=excluded, raw_description=full_desc)
            if existing_mode == "new_unseen" and seen_source_urls:
                relaxed_matches = _exclude_seen_sources(db, relaxed_matches, seen_source_urls)
            if relaxed_matches:
                relax_type = "no_loc"
                offer_msg = (
                    f"No encontré propiedades en {loc}, "
                    f"pero sí tenemos {len(relaxed_matches)} opciones en otras zonas. "
                    f"¿Te gustaría verlas{name_part}? 😊"
                )

        if relaxed_matches and offer_msg:
            session.matched_record_ids = relaxed_matches
            session.current_match_index = 0
            session.state = "collecting_info"
            session.info_step = 6   # awaiting confirmation to show relaxed results
            # Keep merged criteria + store relaxation context for step 6
            session.extracted_criteria = {
                **{k: v for k, v in merged.items() if not k.startswith("_")},
                "_relax_type": relax_type,
                "_relax_loc": loc,
                "_relax_beds": beds,
                "_relax_count": len(relaxed_matches),
            }
            return _text(offer_msg)

        # â”€â”€ Truly nothing found â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        session.state = "collecting_info"
        session.info_step = 4
        if beds and loc:
            hab = "habitación" if beds == 1 else "habitaciones"
            msg = (
                f"Lo siento{name_part}, no encontré propiedades de {beds} {hab} "
                f"en {loc} 😕 ¿Quieres ajustar la búsqueda?"
            )
        elif beds:
            hab = "habitación" if beds == 1 else "habitaciones"
            msg = (
                f"Lo siento{name_part}, no encontré propiedades de {beds} {hab} 😕 "
                "¿Quieres intentar con otros criterios?"
            )
        elif loc:
            msg = (
                f"Lo siento{name_part}, no encontré propiedades en {loc} 😕 "
                "¿Quieres buscar en otra zona?"
            )
        else:
            msg = (
                f"Lo siento{name_part}, no encontré propiedades que coincidan 😕 "
                "Descríbeme de nuevo lo que buscas y lo intento."
            )
        return _text(msg)

    return await _show_property(session, db, matches[0])


async def _handle_presenting(session: WebChatSession, text: str, db: Session) -> dict:
    # Step 20 = awaiting rating feedback. Let intents run first so "Lo quiero" / "Ver siguiente"
    # still work. Clear step 20 before dispatch; intent handlers that re-rate will set it again.
    was_awaiting_feedback = (session.info_step == 20)
    if was_awaiting_feedback:
        session.info_step = 7

    runtime = _build_intent_runtime(session, text, db, session.info_step)
    candidates = candidate_intents_for_state("presenting", session.info_step)
    intent_response = await dispatch_intents(runtime, candidates)
    if intent_response is not None:
        return intent_response

    # No intent fired and we were waiting for feedback — process the text as feedback
    if was_awaiting_feedback:
        session.info_step = 20
        return await _process_rating_feedback(session, text, db)

    t = _normalize_text(text)

    if session.site_user_id and _is_interested_list_request(text):
        return await _show_interested_properties(session, db)

    # Fallback rating path (when intent dispatch didn't fire CALIFICAR_PROPIEDAD)
    rating = _extract_rating_from_text(text)
    if rating and session.site_user_id and session.matched_record_ids:
        return _text(_rate_and_ask_feedback(session, rating, db))

    if any(k in t for k in ["siguiente", "ver siguiente", "otra", "ver otra", "no me convence", "next", "skip"]):
        return await _next_property(session, db)

    if _is_mark_current_property_interest(text) or re.search(r'\bme gusta\b', t) or any(k in t for k in ["asesor", "contactar"]):
        return _do_interested(session, text, db)

    if _is_generic_adjust_request(text):
        session.state = "collecting_info"
        session.info_step = 11
        return _text(
            "Perfecto. Antes de buscar de nuevo, compárteme los parámetros que quieres ajustar "
            "(zona/ciudad, dormitorios, presupuesto, etc.)."
        )

    if _looks_like_search_update(text):
        session.state = "collecting_info"
        session.info_step = 5
        return await _start_search(session, text, db)

    if not _is_scope_message(text):
        return _fallback_out_of_scope()

    return _fallback_not_understood()


async def _next_property(session: WebChatSession, db: Session) -> dict:
    session.current_match_index += 1
    if session.current_match_index >= len(session.matched_record_ids):
        ctx = session.extracted_criteria or {}
        list_mode = ctx.get("_list_mode")
        if list_mode == "interested":
            clean = _clean_criteria(ctx)
            session.extracted_criteria = clean
            session.state = "collecting_info"
            session.info_step = 4
            return _text("Ya te mostre todas las propiedades que marcaste con interes.")

        deferred_alt_ids = list(ctx.get("_deferred_alt_ids") or [])
        if deferred_alt_ids:
            loc = (ctx.get("_deferred_alt_loc") or "").strip()
            req_beds = ctx.get("_deferred_alt_beds")
            count = int(ctx.get("_deferred_alt_count") or len(deferred_alt_ids))

            clean_criteria = {
                k: v
                for k, v in ctx.items()
                if not str(k).startswith("_deferred_alt_") and not str(k).startswith("_relax_")
            }
            session.extracted_criteria = {
                **clean_criteria,
                "_relax_type": "alt_bedrooms_same_loc",
                "_relax_loc": loc,
                "_relax_beds": req_beds,
                "_relax_count": count,
            }
            session.matched_record_ids = deferred_alt_ids
            session.current_match_index = 0
            session.state = "collecting_info"
            session.info_step = 6
            return _text(
                f"Encontré más opciones en {loc} con diferentes números de habitaciones. "
                f"¿Quieres que te muestre estas {count} alternativas también?"
            )

        session.state = "collecting_info"
        session.info_step = 4
        return _text(
            "Has visto todas las propiedades disponibles por ahora. "
            "Si quieres, puedo seguir buscando con otros filtros."
        )

    return await _show_property(session, db, session.matched_record_ids[session.current_match_index])


def _do_interested(session: WebChatSession, text: str, db: Session) -> dict:
    rating = _extract_rating_from_text(text)
    record_id = None
    if session.matched_record_ids and session.current_match_index < len(session.matched_record_ids):
        record_id = session.matched_record_ids[session.current_match_index]

    if session.site_user_id and record_id:
        _upsert_interaction(
            session.site_user_id,
            record_id,
            db,
            interested=True,
            rating=rating,
            rated_at=datetime.now(timezone.utc) if rating else None,
        )
        _track_behavior_signal(session.site_user_id, "interested_record_ids", record_id, db)
        if rating:
            _track_behavior_signal(session.site_user_id, "rated_record_ids", record_id, db)
            if rating <= 2:
                _track_behavior_signal(session.site_user_id, "discarded_record_ids", record_id, db)

    current = dict(session.extracted_criteria or {})
    clean = _clean_criteria(current)
    lead = dict(current.get("_lead") or {})
    if record_id:
        lead["record_id"] = record_id
    if rating:
        lead["rating"] = rating

    lead = _hydrate_lead_from_db(session, lead, db)
    # Business rule: every interested lead must provide proof of purchasing capacity.
    lead["requires_financial_capacity_doc"] = True

    session.extracted_criteria = {**clean, "_lead": lead}
    if lead.get("requires_financial_capacity_doc") and not lead.get("financial_capacity_doc"):
        session.info_step = 12
        session.state = "collecting_info"
        return _text(_build_financial_doc_request_message())

    missing = _get_missing_lead_fields(lead)

    if not missing:
        return _finalize_lead_request(session, clean, lead, db)

    if not (lead.get("country_of_residence") or session.country or "").strip():
        session.info_step = 9
        session.state = "collecting_info"
        return _text(
            "Excelente. Esta propiedad parece interesarte bastante.\n\n"
            "Para que un asesor pueda contactarte, primero dime tu pais de residencia."
        )

    session.info_step = 10
    session.state = "collecting_info"
    return _text(_build_contact_request_message(lead))


def _compose_property_message(session: WebChatSession, idx: int, total: int, data: dict | None = None) -> str:
    """Build a context-aware message that describes what was found."""
    criteria = dict(session.extracted_criteria or {})
    name = session.name or ""
    loc = (criteria.get("location") or "").strip()
    beds: int | None = criteria.get("bedrooms")
    relax_type = str(criteria.get("_relax_type") or "").strip()
    raw_kw = list(criteria.get("keywords") or []) + list(criteria.get("features") or [])
    keywords = [k.strip() for k in raw_kw if isinstance(k, str) and len(k.strip()) > 2]
    bed_counts = _extract_bedroom_counts(data or {}) if isinstance(data, dict) else set()
    has_confirmed_requested_beds = bool(beds and bed_counts and beds in bed_counts)

    _ORDINALS = ["", "primera", "segunda", "tercera", "cuarta", "quinta",
                 "sexta", "séptima", "octava", "novena", "décima"]

    if idx == 1:
        name_part = f", {name}" if name else ""
        if relax_type:
            if relax_type == "loc_only":
                return (
                    f"Aquí tienes una alternativa en {loc}{name_part}. "
                    "No pude confirmar coincidencia exacta de dormitorios en todos los casos, "
                    "pero podrían interesarte 🏠"
                )
            if relax_type == "beds_only":
                return (
                    f"Aquí va una alternativa fuera de {loc}{name_part} "
                    "para ampliar opciones según tu búsqueda 🏠"
                )
            if relax_type in {"no_beds", "alt_bedrooms_same_loc"}:
                return f"Aquí va una alternativa con distinta configuración de dormitorios{name_part} 🏠"
            if relax_type == "no_loc":
                return f"Aquí va una alternativa en otra zona{name_part} 🏠"

        # First property â€” rich intro summarising the search
        feature_parts: list[str] = []
        if loc:
            feature_parts.append(f"en {loc}")
        if beds and has_confirmed_requested_beds:
            hab = "dormitorio" if beds == 1 else "dormitorios"
            feature_parts.append(f"con {beds} {hab}")
        # Include up to 3 meaningful keywords
        generic_terms = {
            "propiedad", "propiedades", "departamento", "departamentos",
            "depa", "depas", "casa", "casas", "inmueble", "inmuebles",
            "zona", "ciudad", "distrito",
        }
        meaningful = [
            k for k in keywords
            if len(k) > 3 and _normalize_text(k) not in generic_terms
        ][:3]
        if meaningful:
            if len(meaningful) == 1:
                feature_parts.append(f"cerca de {meaningful[0]}")
            elif len(meaningful) == 2:
                feature_parts.append(f"con acceso a {meaningful[0]} y {meaningful[1]}")
            else:
                feature_parts.append(
                    f"con acceso a {meaningful[0]}, {meaningful[1]} y {meaningful[2]}"
                )

        if feature_parts:
            desc = " ".join(feature_parts)
            plural = "propiedades" if total > 1 else "propiedad"
            count = f"{total} {plural}" if total > 1 else "una propiedad"
            return (
                f"¡Encontré {count} {desc}! 🎉 "
                f"Aquí va la primera{name_part} 🏠"
            )
        plural = "propiedades" if total > 1 else "propiedad"
        return (
            f"¡Perfecto{name_part}! Encontré {total} {plural} que pueden interesarte 🏠 "
            f"Aquí va la primera:"
        )
    else:
        # Subsequent properties â€” shorter but still contextual
        ordinal = _ORDINALS[idx] if idx < len(_ORDINALS) else f"número {idx}"
        name_part = f", {name}" if name else ""
        if relax_type:
            if loc:
                return f"Aquí va la {ordinal} alternativa en {loc}{name_part} 🏠"
            return f"Esta es la {ordinal} alternativa{name_part} 🏠"
        if loc:
            return f"Aquí va la {ordinal} opción en {loc}{name_part} 🏠"
        return f"Esta es la {ordinal} opción{name_part} 🏠"


async def _show_property(session: WebChatSession, db: Session, record_id: str) -> dict:
    data = get_record_data(db, record_id)
    if not data:
        return await _next_property(session, db)

    seen_by_user_before: bool | None = None
    user_rating: int | None = None

    # Track that this user saw this property
    if session.site_user_id:
        seen_by_user_before = _seen_in_chat_before(session.site_user_id, record_id, db)
        user_rating = _get_user_rating(session.site_user_id, record_id, db)
        _upsert_interaction(
            session.site_user_id, record_id, db,
            seen_in_chat=True,
            seen_at=datetime.now(timezone.utc),
        )
        _track_behavior_signal(session.site_user_id, "viewed_record_ids", record_id, db)

    idx = session.current_match_index + 1
    total = len(session.matched_record_ids)
    ctx = session.extracted_criteria or {}
    list_mode = ctx.get("_list_mode")

    if list_mode == "interested":
        if idx == 1:
            msg = (
                f"Aqui tienes tus propiedades de interes ({total} en total). "
                "Te muestro la primera:"
            )
        else:
            msg = "Aqui va la siguiente propiedad que marcaste con interes:"
    elif list_mode == "filtered_by_rating":
        label = ctx.get("_list_label", "calificadas")
        if idx == 1:
            msg = (
                f"Busque las propiedades que calificaste con {label}. "
                f"Encontre {total} propiedad{'es' if total != 1 else ''}. "
                "Aqui va la primera:"
            )
        else:
            msg = f"Aqui va la siguiente propiedad con {label}:"
    elif list_mode == "filtered_no_price":
        if idx == 1:
            msg = (
                f"Encontre {total} propiedad{'es' if total != 1 else ''} "
                "sin precio conocido. Aqui va la primera:"
            )
        else:
            msg = "Aqui va la siguiente propiedad sin precio conocido:"
    elif list_mode == "by_id":
        msg = "Aqui esta la propiedad que buscaste:"
    else:
        msg = _compose_property_message(session, idx, total, data=data)
        status_warning = _build_project_status_warning(data)
        if status_warning:
            msg = f"{msg}\n\n{status_warning}"

    return _property_card(
        msg,
        idx,
        total,
        record_id,
        data,
        state="presenting",
        seen_by_user_before=seen_by_user_before,
        user_rating=user_rating,
    )




