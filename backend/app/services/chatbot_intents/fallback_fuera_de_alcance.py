"""Intent handler: fallback_fuera_de_alcance."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import FALLBACK_FUERA_DE_ALCANCE


INTENT_NAME = FALLBACK_FUERA_DE_ALCANCE


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.call("is_scope_message", runtime.user_text):
        return None
    return IntentResult(response=runtime.call("fallback_out_of_scope"))

