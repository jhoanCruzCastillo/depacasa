"""Web chatbot conversation handler — session-based, AI-powered."""

import re
import logging
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.web_chat_session import WebChatSession, WebChatMessage
from app.services.matchmaking import find_matches, get_record_data

logger = logging.getLogger(__name__)

_GREETING = (
    "¡Hola! Soy tu asistente inmobiliario 🏠 "
    "Estoy aquí para ayudarte a encontrar la propiedad perfecta. "
    "Para comenzar, ¿cuál es tu correo electrónico?"
)


# ── Response builders ──────────────────────────────────────────────────────────

def _text(msg: str) -> dict:
    return {"message": msg, "card": None, "state": "collecting_info"}


def _property_card(msg: str, index: int, total: int, record_id: str, data: dict, state: str = "presenting") -> dict:
    return {
        "message": msg,
        "card": {"index": index, "total": total, "record_id": record_id, "data": data},
        "state": state,
    }


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
        db.add(h)
        db.flush()
    except Exception as e:
        logger.warning(f"[history] could not save search history: {e}")


def _save_preferences(site_user_id, criteria: dict, description: str, db: Session) -> None:
    """Upsert user preferences from extracted criteria."""
    try:
        from app.models.user_preference import UserPreference
        uid = site_user_id if isinstance(site_user_id, UUID) else UUID(str(site_user_id))
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
    except Exception as e:
        logger.warning(f"[prefs] could not save preferences: {e}")


# ── Public API ─────────────────────────────────────────────────────────────────

async def create_session(db: Session, site_user=None) -> tuple[WebChatSession, dict]:
    session = WebChatSession()

    if site_user:
        session.site_user_id = site_user.id
        session.email = site_user.email
        session.name = site_user.name
        session.country = site_user.country
        session.phone = site_user.phone
        if site_user.name:
            session.info_step = 4
            greeting = (
                f"¡Hola de nuevo, {site_user.name}! 🏠 "
                "Cuéntame, ¿qué tipo de propiedad estás buscando? "
                "Puedes mencionar la ubicación, número de dormitorios, presupuesto o cualquier detalle."
            )
        else:
            session.info_step = 1
            greeting = "¡Te reconozco por tu correo! 😊 ¿Cuál es tu nombre?"
    else:
        greeting = _GREETING

    db.add(session)
    db.flush()
    db.add(WebChatMessage(session_id=session.id, role="assistant", content=greeting))
    db.commit()
    db.refresh(session)
    return session, _text(greeting)


async def handle_message(session_id: str, user_content: str, db: Session) -> dict:
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


# ── FSM ────────────────────────────────────────────────────────────────────────

async def _process(session: WebChatSession, text: str, db: Session) -> dict:
    if session.state == "collecting_info":
        return await _collect_info(session, text, db)
    if session.state == "presenting":
        return await _handle_presenting(session, text, db)
    if session.state == "contact_requested":
        return _text("Tu solicitud ya fue registrada 😊 Un asesor se pondrá en contacto contigo muy pronto.")
    return _text("No entendí tu mensaje. ¿Puedes intentarlo de nuevo?")


async def _collect_info(session: WebChatSession, text: str, db: Session) -> dict:
    from app.services.claude_service import extract_user_field
    step = session.info_step

    if step == 0:  # email
        email = await extract_user_field(0, text)
        session.email = email
        from app.models.site_user import SiteUser
        user = db.query(SiteUser).filter(SiteUser.email == email.lower()).first()
        if user:
            session.site_user_id = user.id
            session.name = user.name
            session.country = user.country
            session.phone = user.phone
            if user.name:
                session.info_step = 4
                return _text(
                    f"¡Bienvenido de nuevo, {user.name}! 😊 "
                    "Cuéntame, ¿qué tipo de propiedad estás buscando? "
                    "Puedes mencionar la ubicación, número de dormitorios, presupuesto o cualquier detalle."
                )
        session.info_step = 1
        return _text("¡Gracias! ¿Cuál es tu nombre?")

    if step == 1:  # name
        name = await extract_user_field(1, text)
        session.name = name
        session.info_step = 2
        return _text(f"¡Mucho gusto, {name}! ¿De qué país eres?")

    if step == 2:  # country
        country = await extract_user_field(2, text)
        session.country = country
        session.info_step = 3
        return _text(
            f"¿Cuál es tu número de celular, {session.name}? "
            "(Con código de país, ej. +51 980 490 696)"
        )

    if step == 3:  # phone
        phone = await extract_user_field(3, text)
        session.phone = phone
        session.info_step = 4
        return _text(
            f"¡Perfecto, {session.name}! Ahora cuéntame, ¿qué tipo de propiedad estás buscando? "
            "Puedes mencionar la ubicación, número de dormitorios, presupuesto o cualquier detalle."
        )

    if step == 4:  # description → start search
        session.ideal_description = text
        session.info_step = 5
        return await _start_search(session, text, db)

    return _text("¿Puedes repetirlo?")


async def _start_search(session: WebChatSession, description: str, db: Session) -> dict:
    try:
        from app.services.claude_service import extract_criteria
        new_criteria = await extract_criteria(description)
    except Exception:
        new_criteria = {"keywords": description.split(), "location": ""}

    # Merge: keep all previous criteria; new non-empty values override
    prev = dict(session.extracted_criteria or {})
    merged: dict = {**prev}
    for k, v in new_criteria.items():
        if v is None or v == "" or (isinstance(v, list) and not v):
            continue
        merged[k] = v
    session.extracted_criteria = merged

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
    excluded: set[str] = set()
    if session.site_user_id:
        excluded = _get_disliked_ids(session.site_user_id, db)

    matches = await find_matches(db, merged, top_n, excluded_ids=excluded, raw_description=full_desc)
    session.matched_record_ids = matches
    session.current_match_index = 0
    session.state = "presenting"

    if not matches:
        session.state = "collecting_info"
        session.info_step = 4
        loc = criteria.get("location") or ""
        beds = criteria.get("bedrooms")
        if beds and loc:
            hab = "habitación" if beds == 1 else "habitaciones"
            msg = (
                f"Lo siento, {session.name}, no encontré propiedades de {beds} {hab} "
                f"en {loc} 😕 ¿Quieres ajustar el número de habitaciones o buscar en otra zona?"
            )
        elif beds:
            hab = "habitación" if beds == 1 else "habitaciones"
            msg = (
                f"Lo siento, {session.name}, no encontré propiedades de {beds} {hab} 😕 "
                "¿Quieres intentar con otros criterios?"
            )
        elif loc:
            msg = (
                f"Lo siento, {session.name}, no encontré propiedades en {loc} 😕 "
                "¿Quieres buscar en otra zona o ajustar los criterios?"
            )
        else:
            msg = (
                f"Lo siento, {session.name}, no encontré propiedades que coincidan 😕 "
                "¿Quieres intentar con otros criterios? Descríbeme de nuevo lo que buscas."
            )
        return _text(msg)

    return await _show_property(session, db, matches[0])


async def _handle_presenting(session: WebChatSession, text: str, db: Session) -> dict:
    t = text.lower()
    if any(k in t for k in ["siguiente", "otra", "más", "ver más", "no me", "next", "skip"]):
        return await _next_property(session, db)
    if any(k in t for k in ["interesa", "quiero", "este", "sí", "si", "contactar", "lo quiero", "me gusta"]):
        return _do_interested(session, text, db)
    # Re-show current property
    idx = session.current_match_index
    if idx < len(session.matched_record_ids):
        return await _show_property(session, db, session.matched_record_ids[idx])
    return _text("¿Deseas ver otra propiedad o que un asesor te contacte?")


async def _next_property(session: WebChatSession, db: Session) -> dict:
    session.current_match_index += 1
    if session.current_match_index >= len(session.matched_record_ids):
        session.state = "contact_requested"
        return {
            **_text(
                f"Has visto todas las propiedades disponibles, {session.name}. "
                "Un asesor se pondrá en contacto contigo para ofrecerte más opciones personalizadas. ¡Gracias!"
            ),
            "state": "contact_requested",
        }
    return await _show_property(session, db, session.matched_record_ids[session.current_match_index])


def _do_interested(session: WebChatSession, text: str, db: Session) -> dict:
    session.state = "contact_requested"

    # Extract star rating from text ("lo quiero, le doy 4 estrellas")
    rating: int | None = None
    m = re.search(r'(\d)\s*estrella', text.lower())
    if m:
        rating = int(m.group(1))

    # Track interest + rating for the current property
    if session.site_user_id and session.matched_record_ids:
        idx = session.current_match_index
        if idx < len(session.matched_record_ids):
            record_id = session.matched_record_ids[idx]
            _upsert_interaction(
                session.site_user_id, record_id, db,
                interested=True,
                rating=rating,
                rated_at=datetime.now(timezone.utc) if rating else None,
            )

    phone_display = session.phone or "tu número"
    return {
        **_text(
            f"¡Excelente elección, {session.name}! 🎉 "
            f"Un asesor se pondrá en contacto contigo al {phone_display} a la brevedad. "
            "¡Gracias por elegirnos!"
        ),
        "state": "contact_requested",
    }


async def _show_property(session: WebChatSession, db: Session, record_id: str) -> dict:
    data = get_record_data(db, record_id)
    if not data:
        return await _next_property(session, db)

    # Track that this user saw this property
    if session.site_user_id:
        _upsert_interaction(
            session.site_user_id, record_id, db,
            seen_in_chat=True,
            seen_at=datetime.now(timezone.utc),
        )

    idx = session.current_match_index + 1
    total = len(session.matched_record_ids)
    msg = f"Aquí está la propiedad {idx} de {total} que encontré para ti 🏠"
    return _property_card(msg, idx, total, record_id, data, state="presenting")
