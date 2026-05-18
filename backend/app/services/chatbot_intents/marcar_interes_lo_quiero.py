"""Intent handler: marcar_interes_lo_quiero."""

from __future__ import annotations
import re

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import MARCAR_INTERES_LO_QUIERO


INTENT_NAME = MARCAR_INTERES_LO_QUIERO


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.state != "presenting":
        return None

    text = runtime.user_text
    normalized = runtime.call("normalize_text", text)
    # Use word boundary so "me gustaria" does not match "me gusta"
    likes_it = bool(re.search(r'\bme gusta\b', normalized))
    if not (
        runtime.call("is_mark_current_property_interest", text)
        or likes_it
        or any(term in normalized for term in ["asesor", "contactar"])
    ):
        return None

    return IntentResult(response=runtime.call("mark_interest", text))

