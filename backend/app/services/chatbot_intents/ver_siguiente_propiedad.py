"""Intent handler: ver_siguiente_propiedad."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import VER_SIGUIENTE_PROPIEDAD


INTENT_NAME = VER_SIGUIENTE_PROPIEDAD


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.state != "presenting":
        return None
    if not runtime.call("wants_next_property", runtime.user_text):
        return None
    return IntentResult(response=await runtime.acall("next_property"))

