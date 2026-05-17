"""Intent handler: capturar_sustento_financiero."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import CAPTURAR_SUSTENTO_FINANCIERO


INTENT_NAME = CAPTURAR_SUSTENTO_FINANCIERO


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.state != "collecting_info":
        return None
    if runtime.step != 12:
        return None
    return IntentResult(response=await runtime.acall("handle_financial_document_step"))

