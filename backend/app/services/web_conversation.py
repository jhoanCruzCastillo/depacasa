"""Web chatbot conversation handler — session-based, AI-powered."""

import re
import logging
import unicodedata
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.web_chat_session import WebChatSession, WebChatMessage
from app.services.matchmaking import find_matches, get_record_data

logger = logging.getLogger(__name__)

_GREETING = (
    "Hola. Soy tu asistente inmobiliario. "
    "Estoy aqu? para ayudarte a encontrar una propiedad que encaje contigo. "
    "?Qu? est?s buscando exactamente?"
)


# ── Response builders ──────────────────────────────────────────────────────────

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
) -> dict:
    return {
        "message": msg,
        "card": {
            "index": index,
            "total": total,
            "record_id": record_id,
            "property_identifier": record_id,
            "seen_by_user_before": seen_by_user_before,
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
    if c.get("location") or c.get("bedrooms") or c.get("min_price") or c.get("max_price"):
        return True
    if c.get("features") or c.get("keywords"):
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
    return norm.split()[0] in yes_words


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
        "miraflores", "surco",
    ]
    return any(h in norm for h in hints)


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
    if loc:
        parts.append(f"zona: {loc}")
    if beds:
        hab = "dormitorio" if beds == 1 else "dormitorios"
        parts.append(f"{beds} {hab}")
    budget = _format_budget(c.get("min_price"), c.get("max_price"))
    if budget:
        parts.append(f"presupuesto {budget}")
    if not parts:
        return "sin criterios guardados todavia"
    return ", ".join(parts)


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
        "modificar parametros",
        "nueva busqueda",
        "quiero ajustar",
    ]
    return any(h in t for h in hints)


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
        from app.models.scraped_record import ScrapedRecord
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        rows = (
            db.query(ScrapedRecord.source_url)
            .join(UserPropertyInteraction, UserPropertyInteraction.record_id == ScrapedRecord.id)
            .filter(
                UserPropertyInteraction.site_user_id == uid,
                UserPropertyInteraction.seen_in_chat.is_(True),
                ScrapedRecord.source_url.isnot(None),
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
        from app.models.scraped_record import ScrapedRecord
        rid = UUID(record_id)
        row = db.query(ScrapedRecord.source_url).filter(ScrapedRecord.id == rid).first()
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


# ── Interaction tracking helpers ───────────────────────────────────────────────

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


def _save_preferences(site_user_id, criteria: dict, description: str, db: Session) -> None:
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
            pref.location = criteria.get("location") or pref.location
            pref.bedrooms = criteria.get("bedrooms") or pref.bedrooms
            pref.min_price = criteria.get("min_price") or pref.min_price
            pref.max_price = criteria.get("max_price") or pref.max_price
            pref.features = criteria.get("features") or pref.features
            pref.keywords = criteria.get("keywords") or pref.keywords
            pref.raw_description = description
            db.flush()
            sp.commit()
        except Exception:
            sp.rollback()
            raise
    except Exception as e:
        logger.warning(f"[prefs] could not save preferences: {e}")


def _load_saved_preferences(site_user_id, db: Session) -> tuple[dict, str]:
    try:
        from app.models.user_preference import UserPreference
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
        pref = db.query(UserPreference).filter_by(site_user_id=uid).first()
        if not pref:
            return {}, ""
        criteria = {
            "location": pref.location,
            "bedrooms": pref.bedrooms,
            "min_price": pref.min_price,
            "max_price": pref.max_price,
            "features": pref.features or [],
            "keywords": pref.keywords or [],
        }
        clean = {
            k: v for k, v in criteria.items()
            if v not in (None, "", []) and v != {}
        }
        return clean, pref.raw_description or ""
    except Exception as e:
        logger.warning(f"[prefs] could not load preferences: {e}")
        return {}, ""


# ── Public API ─────────────────────────────────────────────────────────────────

async def create_session(db: Session, site_user=None) -> tuple[WebChatSession, dict]:
    session = WebChatSession()

    if site_user:
        session.site_user_id = site_user.id
        session.email = site_user.email
        session.name = site_user.name
        session.country = site_user.country
        session.phone = site_user.phone

    session.info_step = 4
    greeting = _GREETING

    if site_user and site_user.name:
        saved_criteria, saved_desc = _load_saved_preferences(site_user.id, db)
        session.extracted_criteria = saved_criteria
        session.ideal_description = saved_desc or session.ideal_description
        session.info_step = 8
        summary = _summarize_preferences(saved_criteria)
        greeting = (
            f"Hola de nuevo, {site_user.name}. Tengo guardada tu busqueda anterior: {summary}.\n"
            "Quieres que continuemos con cual opcion?\n"
            "1. Ver propiedades nuevas o que aun no has visto.\n"
            "2. Volver a ver propiedades que ya revisaste."
        )

    db.add(session)
    db.flush()
    db.add(WebChatMessage(session_id=session.id, role="assistant", content=greeting))
    db.commit()
    db.refresh(session)
    return session, _text(greeting)


async def handle_message(session_id: str, user_content: str, db: Session) -> dict:
    try:
        session = db.query(WebChatSession).filter(WebChatSession.id == UUID(session_id)).first()
        if not session:
            return _text("Sesión no encontrada.")

        text = user_content.strip()
        db.add(WebChatMessage(session_id=session.id, role="user", content=text))

        result = await _process(session, text, db)
        result.setdefault("state", session.state)

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


# ── FSM ────────────────────────────────────────────────────────────────────────

async def _process(session: WebChatSession, text: str, db: Session) -> dict:
    if session.state == "collecting_info":
        return await _collect_info(session, text, db)
    if session.state == "presenting":
        return await _handle_presenting(session, text, db)
    if session.state == "contact_requested":
        if session.site_user_id and _is_interested_list_request(text):
            return await _show_interested_properties(session, db)
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

    if step == 4:
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
                "Perfecto. Dime quÃ© quieres ajustar (zona, dormitorios, presupuesto o caracterÃ­sticas) "
                "y busco nuevas opciones."
            )

        if session.site_user_id and _is_interested_list_request(user_text):
            return await _show_interested_properties(session, db)

        if session.site_user_id and _is_viewed_request(user_text):
            viewed_ids = _get_viewed_ranked_ids(session.site_user_id, db)
            if not viewed_ids:
                return _text(
                    "A?n no tienes propiedades vistas registradas. "
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
                "Perfecto. Dime quÃ© quieres ajustar (zona, dormitorios, presupuesto o caracterÃ­sticas) "
                "y busco nuevas opciones."
            )

        if session.site_user_id and _is_interested_list_request(user_text):
            return await _show_interested_properties(session, db)

        if session.site_user_id and _is_viewed_request(user_text):
            viewed_ids = _get_viewed_ranked_ids(session.site_user_id, db)
            if not viewed_ids:
                return _text("A?n no tengo propiedades vistas para mostrarte. ?Buscamos opciones nuevas?")
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
            return _text("Perfecto. Cu?ntame qu? est?s buscando exactamente para iniciar la b?squeda.")

        if _is_negative_message(user_text):
            session.info_step = 4
            return _text("Listo. Cuando quieras, dime qu? propiedad buscas y arrancamos.")

        summary = _summarize_preferences(current_criteria if has_saved_criteria else {})
        if has_saved_criteria:
            return _text(
                f"Si quieres, busco con tus preferencias ({summary}). "
                "Tambi?n puedes responder 1 (nuevas/no vistas) o 2 (vistas)."
            )
        return _text("?Quieres que empecemos una b?squeda? Puedes contarme zona, dormitorios y presupuesto.")

    if step == 6:
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
            "Entendido. Mantendr? los filtros actuales. "
            "Si quieres, dime qu? ajustamos (zona, dormitorios, presupuesto)."
        )

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
        doc_label = _country_to_doc_label(country)
        return _text(
            "Perfecto, gracias. Ahora comparteme estos datos para que un asesor pueda contactarte:\n"
            "Nombres y apellidos completos:\n"
            "WhatsApp:\n"
            f"{doc_label}:"
        )

    if step == 10:
        from app.services.claude_service import extract_contact_fields
        clean = _clean_criteria(ctx)
        lead = dict((ctx or {}).get("_lead") or {})
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

        missing = []
        if not lead.get("full_name"):
            missing.append("nombres y apellidos")
        if not lead.get("whatsapp"):
            missing.append("WhatsApp")
        if not lead.get("document_number"):
            missing.append(_country_to_doc_label(lead.get("country_of_residence")))

        session.extracted_criteria = {**clean, "_lead": lead}

        if missing:
            if len(missing) == 1:
                return _text(f"Gracias. Solo me falta tu {missing[0]} para completar la solicitud.")
            return _text("Gracias. Para completar la solicitud aun me faltan: " + ", ".join(missing) + ".")

        session.name = lead.get("full_name") or session.name
        session.phone = lead.get("whatsapp") or session.phone

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
                    su.country = su.country or lead.get("country_of_residence")
            except Exception as e:
                logger.warning(f"[lead] could not persist contact data: {e}")

        record_id = lead.get("record_id")
        if session.site_user_id and record_id:
            _upsert_interaction(session.site_user_id, record_id, db, interested=True)

        session.info_step = 4
        session.state = "collecting_info"
        return _text(
            "Listo, ya registr? tu inter?s en esta propiedad. "
            "Un asesor podr? contactarte por WhatsApp para darte m?s informaci?n. "
            "Si quieres, tambi?n puedo seguir mostr?ndote opciones similares."
        )

    return _fallback_not_understood()


async def _start_search(session: WebChatSession, description: str, db: Session) -> dict:
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
    explicit_min_price, explicit_max_price = _extract_explicit_price_limits(description)
    if explicit_min_price is not None:
        new_criteria["min_price"] = explicit_min_price
    if explicit_max_price is not None:
        new_criteria["max_price"] = explicit_max_price

    # Merge: keep all previous criteria (strip internal _relax_* keys); new non-empty values override
    prev = _clean_criteria(session.extracted_criteria)
    merged: dict = {**prev}
    for k, v in new_criteria.items():
        if v is None or v == "" or (isinstance(v, list) and not v):
            continue
        merged[k] = v
    # Build full description context: original intent + current adjustment
    original = session.ideal_description or ""
    if original and description != original:
        full_desc = f"{original}\nAjuste del usuario: {description}"
    else:
        full_desc = description

    # Save preferences + search history for registered users
    if session.site_user_id:
        _save_preferences(session.site_user_id, merged, full_desc, db)
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

        # ── Relaxed search: find something close to offer proactively ─────────
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
                    f"No encontré propiedades de {beds} {hab} en {loc}, "
                    f"pero sí tenemos {len(relaxed_matches)} opciones disponibles en {loc}. "
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
                        f"No encontré propiedades de {beds} {hab} en {loc}, "
                        f"pero sí tenemos {len(relaxed_matches)} de {beds} {hab} en otras zonas. "
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

        # ── Truly nothing found ───────────────────────────────────────────────
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
    t = _normalize_text(text)

    if session.site_user_id and _is_interested_list_request(text):
        return await _show_interested_properties(session, db)

    rating = _extract_rating_from_text(text)
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
        return _text(_rating_feedback(rating))

    if any(k in t for k in ["siguiente", "ver siguiente", "otra", "ver otra", "no me convence", "next", "skip"]):
        return await _next_property(session, db)

    if _is_mark_current_property_interest(text) or any(k in t for k in ["me gusta", "asesor", "contactar"]):
        return _do_interested(session, text, db)

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
                f"Encontr? m?s opciones en {loc} con diferentes n?meros de habitaciones. "
                f"?Quieres que te muestre estas {count} alternativas tambi?n?"
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

    current = dict(session.extracted_criteria or {})
    clean = _clean_criteria(current)
    lead = dict(current.get("_lead") or {})
    if record_id:
        lead["record_id"] = record_id
    if rating:
        lead["rating"] = rating
    session.extracted_criteria = {**clean, "_lead": lead}

    if not (session.country or "").strip():
        session.info_step = 9
        session.state = "collecting_info"
        return _text(
            "Excelente. Esta propiedad parece interesarte bastante.\n\n"
            "Para que un asesor pueda contactarte, primero dime tu pais de residencia."
        )

    session.info_step = 10
    session.state = "collecting_info"
    doc_label = _country_to_doc_label(session.country)
    return _text(
        "Perfecto. Ahora comparteme estos datos para que un asesor pueda contactarte:\n"
        "Nombres y apellidos completos:\n"
        "WhatsApp:\n"
        f"{doc_label}:"
    )


def _compose_property_message(session: WebChatSession, idx: int, total: int) -> str:
    """Build a context-aware message that describes what was found."""
    criteria = dict(session.extracted_criteria or {})
    name = session.name or ""
    loc = (criteria.get("location") or "").strip()
    beds: int | None = criteria.get("bedrooms")
    raw_kw = list(criteria.get("keywords") or []) + list(criteria.get("features") or [])
    keywords = [k.strip() for k in raw_kw if isinstance(k, str) and len(k.strip()) > 2]

    _ORDINALS = ["", "primera", "segunda", "tercera", "cuarta", "quinta",
                 "sexta", "séptima", "octava", "novena", "décima"]

    if idx == 1:
        # First property — rich intro summarising the search
        feature_parts: list[str] = []
        if loc:
            feature_parts.append(f"en {loc}")
        if beds:
            hab = "dormitorio" if beds == 1 else "dormitorios"
            feature_parts.append(f"con {beds} {hab}")
        # Include up to 3 meaningful keywords
        meaningful = [k for k in keywords if len(k) > 3][:3]
        if meaningful:
            if len(meaningful) == 1:
                feature_parts.append(f"cerca de {meaningful[0]}")
            elif len(meaningful) == 2:
                feature_parts.append(f"con acceso a {meaningful[0]} y {meaningful[1]}")
            else:
                feature_parts.append(
                    f"con acceso a {meaningful[0]}, {meaningful[1]} y {meaningful[2]}"
                )

        name_part = f", {name}" if name else ""
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
        # Subsequent properties — shorter but still contextual
        ordinal = _ORDINALS[idx] if idx < len(_ORDINALS) else f"número {idx}"
        name_part = f", {name}" if name else ""
        if loc:
            return f"Aquí va la {ordinal} opción en {loc}{name_part} 🏠"
        return f"Esta es la {ordinal} opción{name_part} 🏠"


async def _show_property(session: WebChatSession, db: Session, record_id: str) -> dict:
    data = get_record_data(db, record_id)
    if not data:
        return await _next_property(session, db)

    seen_by_user_before: bool | None = None

    # Track that this user saw this property
    if session.site_user_id:
        seen_by_user_before = _seen_in_chat_before(session.site_user_id, record_id, db)
        _upsert_interaction(
            session.site_user_id, record_id, db,
            seen_in_chat=True,
            seen_at=datetime.now(timezone.utc),
        )

    idx = session.current_match_index + 1
    total = len(session.matched_record_ids)
    ctx = session.extracted_criteria or {}
    if ctx.get("_list_mode") == "interested":
        if idx == 1:
            msg = (
                f"Aqui tienes tus propiedades de interes ({total} en total). "
                "Te muestro la primera:"
            )
        else:
            msg = "Aqui va la siguiente propiedad que marcaste con interes:"
    else:
        msg = _compose_property_message(session, idx, total)
    return _property_card(
        msg,
        idx,
        total,
        record_id,
        data,
        state="presenting",
        seen_by_user_before=seen_by_user_before,
    )

