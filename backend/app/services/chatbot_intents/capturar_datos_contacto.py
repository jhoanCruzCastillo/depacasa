"""Intent handler: capturar_datos_contacto."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import CAPTURAR_DATOS_CONTACTO


INTENT_NAME = CAPTURAR_DATOS_CONTACTO


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.state != "collecting_info":
        return None
    if runtime.step not in {9, 10}:
        return None
    return IntentResult(response=await runtime.acall("handle_contact_capture_step"))

