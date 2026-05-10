"""Twilio WhatsApp integration."""

import logging
from config import settings

logger = logging.getLogger(__name__)

_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg")


def _get_client():
    from twilio.rest import Client  # deferred import
    return Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


def send_message(to: str, body: str) -> str | None:
    """Send a plain text WhatsApp message. Returns message SID or None on error."""
    try:
        client = _get_client()
        msg = client.messages.create(
            from_=settings.TWILIO_WHATSAPP_NUMBER,
            to=to,
            body=body,
        )
        logger.info(f"Message sent → {to}: {msg.sid}")
        return msg.sid
    except Exception as e:
        logger.error(f"Twilio send error → {to}: {e}")
        return None


def _is_image_value(value) -> bool:
    if not isinstance(value, str):
        return False
    v = value.lower().split("?")[0]
    return v.startswith("/media/") or any(v.endswith(ext) for ext in _IMAGE_EXTS)


def format_property_card(record_data: dict, index: int, total: int) -> str:
    """Format a scraped record's data as a WhatsApp-friendly message."""
    lines = [f"🏠 *Propiedad {index} de {total}*\n"]

    for key, value in record_data.items():
        if value is None or value == "" or value == []:
            continue

        if isinstance(value, list):
            text_values = [str(v) for v in value if not _is_image_value(v)]
            if not text_values:
                continue
            label = key.replace("_", " ").title()
            lines.append(f"• *{label}:* {', '.join(text_values[:5])}")
        elif _is_image_value(value):
            continue
        elif isinstance(value, str) and len(value) > 400:
            label = key.replace("_", " ").title()
            lines.append(f"• *{label}:* {value[:397]}...")
        else:
            label = key.replace("_", " ").title()
            lines.append(f"• *{label}:* {value}")

    lines.append("\n¿Qué deseas hacer?")
    lines.append("*1* ➡️ Ver más propiedades")
    lines.append("*2* ✅ Lo quiero (contactar asesor)")
    lines.append("*⭐* Calificar esta propiedad")

    return "\n".join(lines)


def parse_incoming(form_data: dict) -> dict:
    return {
        "from": form_data.get("From", ""),
        "to": form_data.get("To", ""),
        "body": (form_data.get("Body", "") or "").strip(),
        "message_sid": form_data.get("MessageSid", ""),
        "num_media": int(form_data.get("NumMedia", 0)),
    }


def is_ver_mas(body: str) -> bool:
    b = body.lower().strip()
    return b in {"1", "ver más", "ver mas", "siguiente", "más", "mas", "more", "next", "otra", "otro"}


def is_lo_quiero(body: str) -> bool:
    b = body.lower().strip()
    return b in {"2", "lo quiero", "me interesa", "quiero", "interesa", "contactar", "asesor", "contacto"}


def is_calificar(body: str) -> bool:
    b = body.lower().strip()
    return b in {"⭐", "★", "calificar", "califico", "rating", "3"}
