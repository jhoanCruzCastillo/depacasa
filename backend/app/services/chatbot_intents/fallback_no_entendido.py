"""Intent handler: fallback_no_entendido."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import FALLBACK_NO_ENTENDIDO


INTENT_NAME = FALLBACK_NO_ENTENDIDO


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    response = await runtime.acall("contextual_fallback_response")
    if isinstance(response, dict):
        return IntentResult(response=response)
    return IntentResult(response=runtime.call("fallback_not_understood"))
