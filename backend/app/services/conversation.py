"""Conversation state machine for WhatsApp chatbot."""

import logging
from datetime import datetime
from sqlalchemy.orm import Session

from app.models.chat_user import ChatUser
from app.models.chat_conversation import ChatConversation, ConversationState
from app.models.chat_message import ChatMessage, MessageDirection
from app.models.chat_config import ChatConfig, DEFAULT_CONFIG_ID
from app.services import matchmaking, twilio_service
from app.services.claude_service import extract_criteria

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_or_create_user(phone: str, db: Session) -> ChatUser:
    user = db.query(ChatUser).filter(ChatUser.phone_number == phone).first()
    if not user:
        user = ChatUser(phone_number=phone, profile={"interaction_count": 0})
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _get_active_conversation(user_id, db: Session) -> ChatConversation | None:
    return (
        db.query(ChatConversation)
        .filter(
            ChatConversation.user_id == user_id,
            ChatConversation.state != ConversationState.CONTACT_REQUESTED,
        )
        .order_by(ChatConversation.created_at.desc())
        .first()
    )


def _get_config(db: Session) -> ChatConfig:
    config = db.query(ChatConfig).filter(ChatConfig.id == DEFAULT_CONFIG_ID).first()
    if not config:
        config = ChatConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def _save_message(conv_id, direction: str, content: str, sid: str | None, db: Session):
    msg = ChatMessage(
        conversation_id=conv_id,
        direction=direction,
        content=content,
        twilio_sid=sid,
    )
    db.add(msg)
    db.commit()


def _send(phone: str, body: str, conv_id, db: Session):
    sid = twilio_service.send_message(phone, body)
    _save_message(conv_id, MessageDirection.OUTBOUND, body, sid, db)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def handle_incoming(phone: str, body: str, message_sid: str, db: Session):
    """Process an incoming WhatsApp message and reply accordingly."""
    user = _get_or_create_user(phone, db)

    # Update interaction profile
    profile = dict(user.profile or {})
    profile["interaction_count"] = profile.get("interaction_count", 0) + 1
    profile["last_seen"] = datetime.utcnow().isoformat()
    user.profile = profile
    user.updated_at = datetime.utcnow()
    db.commit()

    conv = _get_active_conversation(user.id, db)

    # ---- New conversation ----
    if not conv:
        conv = ChatConversation(user_id=user.id, state=ConversationState.GREETING)
        db.add(conv)
        db.commit()
        db.refresh(conv)

        _save_message(conv.id, MessageDirection.INBOUND, body, message_sid, db)

        config = _get_config(db)
        greeting = config.greeting_message.replace("{user_name}", user.name or "")
        _send(phone, greeting, conv.id, db)
        return

    _save_message(conv.id, MessageDirection.INBOUND, body, message_sid, db)

    # ---- State machine ----
    if conv.state == ConversationState.GREETING:
        await _handle_description(conv, body, phone, db)

    elif conv.state == ConversationState.PRESENTING:
        if twilio_service.is_ver_mas(body):
            await _handle_ver_mas(conv, phone, db)
        elif twilio_service.is_lo_quiero(body):
            await _handle_lo_quiero(conv, phone, db)
        elif twilio_service.is_calificar(body):
            _send(
                phone,
                "Gracias por tu calificacion ⭐\n\n"
                "Puedes seguir explorando:\n"
                "*1* ➡️ Ver mas propiedades\n"
                "O describeme que mas buscas y actualizo tu busqueda.",
                conv.id,
                db,
            )
        else:
            # Treat as updated description → re-run matchmaking
            _send(phone, "Actualizando tu busqueda con las nuevas preferencias...", conv.id, db)
            await _handle_description(conv, body, phone, db)


# ---------------------------------------------------------------------------
# State handlers
# ---------------------------------------------------------------------------

async def _handle_description(conv: ChatConversation, description: str, phone: str, db: Session):
    config = _get_config(db)

    criteria = await extract_criteria(description)
    matched_ids = await matchmaking.find_matches(db, criteria, config.top_n_properties)

    conv.ideal_description = description
    conv.extracted_criteria = criteria
    conv.matched_record_ids = matched_ids
    conv.current_match_index = 0
    conv.state = ConversationState.PRESENTING
    conv.updated_at = datetime.utcnow()
    db.commit()

    if not matched_ids:
        _send(phone, config.no_results_message, conv.id, db)
        return

    await _show_current_property(conv, phone, db, config)


async def _handle_ver_mas(conv: ChatConversation, phone: str, db: Session):
    config = _get_config(db)
    matched_ids = conv.matched_record_ids or []
    next_index = conv.current_match_index + 1

    if next_index >= len(matched_ids):
        _send(phone, config.no_more_message, conv.id, db)
        return

    conv.current_match_index = next_index
    conv.updated_at = datetime.utcnow()
    db.commit()

    await _show_current_property(conv, phone, db, config)


async def _handle_lo_quiero(conv: ChatConversation, phone: str, db: Session):
    config = _get_config(db)
    conv.state = ConversationState.CONTACT_REQUESTED
    conv.updated_at = datetime.utcnow()
    db.commit()
    _send(phone, config.contact_message, conv.id, db)


async def _show_current_property(conv: ChatConversation, phone: str, db: Session, config: ChatConfig):
    matched_ids = conv.matched_record_ids or []
    idx = conv.current_match_index

    if idx >= len(matched_ids):
        _send(phone, config.no_more_message, conv.id, db)
        return

    record_id = matched_ids[idx]
    data = matchmaking.get_record_data(db, record_id)

    if not data:
        # Skip corrupt/missing record and try next
        conv.current_match_index += 1
        conv.updated_at = datetime.utcnow()
        db.commit()
        if conv.current_match_index < len(matched_ids):
            await _show_current_property(conv, phone, db, config)
        else:
            _send(phone, config.no_more_message, conv.id, db)
        return

    total_visible = min(len(matched_ids), config.top_n_properties * 5)
    card = twilio_service.format_property_card(data, idx + 1, total_visible)
    _send(phone, card, conv.id, db)
