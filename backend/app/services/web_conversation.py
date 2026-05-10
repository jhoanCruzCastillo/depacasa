"""Web chatbot conversation handler — session-based, AI-powered."""

import logging
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
    return {"message": msg, "card": None}


def _property_card(msg: str, index: int, total: int, record_id: str, data: dict) -> dict:
    return {
        "message": msg,
        "card": {
            "index": index,
            "total": total,
            "record_id": record_id,
            "data": data,
        },
    }


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
            session.info_step = 4  # skip straight to description
            greeting = (
                f"¡Hola de nuevo, {site_user.name}! 🏠 "
                "Cuéntame, ¿qué tipo de propiedad estás buscando? "
                "Puedes mencionar la ubicación, número de dormitorios, presupuesto o cualquier detalle."
            )
        else:
            session.info_step = 1  # have email, still need name
            greeting = (
                "¡Te reconozco por tu correo! 😊 "
                "¿Cuál es tu nombre?"
            )
    else:
        greeting = _GREETING

    db.add(session)
    db.flush()
    db.add(WebChatMessage(session_id=session.id, role="assistant", content=greeting))
    db.commit()
    db.refresh(session)
    return session, _text(greeting)


async def handle_message(session_id: str, user_content: str, db: Session) -> dict:
    from uuid import UUID
    session = db.query(WebChatSession).filter(WebChatSession.id == UUID(session_id)).first()
    if not session:
        return _text("Sesión no encontrada.")

    text = user_content.strip()
    db.add(WebChatMessage(session_id=session.id, role="user", content=text))

    result = await _process(session, text, db)

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
        # Check if user already has an account
        from app.models.site_user import SiteUser
        user = db.query(SiteUser).filter(SiteUser.email == email.lower()).first()
        if user:
            session.site_user_id = user.id
            session.name = user.name
            session.country = user.country
            session.phone = user.phone
            if user.name:
                session.info_step = 4  # skip to description
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

    if step == 4:  # description
        session.ideal_description = text
        session.info_step = 5
        return await _start_search(session, text, db)

    return _text("¿Puedes repetirlo?")


async def _start_search(session: WebChatSession, description: str, db: Session) -> dict:
    try:
        from app.services.claude_service import extract_criteria
        criteria = await extract_criteria(description)
    except Exception:
        criteria = {"keywords": description.split(), "location": ""}
    session.extracted_criteria = criteria

    from app.models.chat_config import ChatConfig, DEFAULT_CONFIG_ID
    config = db.query(ChatConfig).filter(ChatConfig.id == DEFAULT_CONFIG_ID).first()
    top_n = config.top_n_properties if config else 3

    matches = await find_matches(db, criteria, top_n)
    session.matched_record_ids = matches
    session.current_match_index = 0
    session.state = "presenting"

    if not matches:
        session.state = "collecting_info"
        session.info_step = 4
        return _text(
            f"Lo siento, {session.name}, no encontré propiedades que coincidan 😕 "
            "¿Quieres intentar con otros criterios? Descríbeme de nuevo lo que buscas."
        )

    return await _show_property(session, db, matches[0])


async def _handle_presenting(session: WebChatSession, text: str, db: Session) -> dict:
    t = text.lower()
    if any(k in t for k in ["siguiente", "otra", "más", "ver más", "no me", "next", "skip"]):
        return await _next_property(session, db)
    if any(k in t for k in ["interesa", "quiero", "este", "sí", "si", "contactar", "lo quiero", "me gusta"]):
        return _do_interested(session)
    # Re-show current property
    idx = session.current_match_index
    if idx < len(session.matched_record_ids):
        return await _show_property(session, db, session.matched_record_ids[idx])
    return _text("¿Deseas ver otra propiedad o que un asesor te contacte?")


async def _next_property(session: WebChatSession, db: Session) -> dict:
    session.current_match_index += 1
    if session.current_match_index >= len(session.matched_record_ids):
        session.state = "contact_requested"
        return _text(
            f"Has visto todas las propiedades disponibles, {session.name}. "
            "Un asesor se pondrá en contacto contigo para ofrecerte más opciones personalizadas. ¡Gracias!"
        )
    return await _show_property(session, db, session.matched_record_ids[session.current_match_index])


def _do_interested(session: WebChatSession) -> dict:
    session.state = "contact_requested"
    phone_display = session.phone or "tu número"
    return _text(
        f"¡Excelente elección, {session.name}! 🎉 "
        f"Un asesor se pondrá en contacto contigo al {phone_display} a la brevedad. "
        "¡Gracias por elegirnos!"
    )


async def _show_property(session: WebChatSession, db: Session, record_id: str) -> dict:
    data = get_record_data(db, record_id)
    if not data:
        return await _next_property(session, db)

    idx = session.current_match_index + 1
    total = len(session.matched_record_ids)
    msg = f"Aquí está la propiedad {idx} de {total} que encontré para ti 🏠"

    return _property_card(msg, idx, total, record_id, data)
