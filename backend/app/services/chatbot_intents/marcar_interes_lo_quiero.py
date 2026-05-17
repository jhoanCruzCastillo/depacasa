"""Intent handler: marcar_interes_lo_quiero."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import MARCAR_INTERES_LO_QUIERO


INTENT_NAME = MARCAR_INTERES_LO_QUIERO


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.state != "presenting":
        return None

    text = runtime.user_text
    if not (
        runtime.call("is_mark_current_property_interest", text)
        or any(term in runtime.call("normalize_text", text) for term in ["me gusta", "asesor", "contactar"])
    ):
        return None

    return IntentResult(response=runtime.call("mark_interest", text))

