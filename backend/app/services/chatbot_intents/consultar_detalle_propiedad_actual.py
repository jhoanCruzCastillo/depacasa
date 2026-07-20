"""Intent handler: consultar_detalle_propiedad_actual."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import CONSULTAR_DETALLE_PROPIEDAD_ACTUAL


INTENT_NAME = CONSULTAR_DETALLE_PROPIEDAD_ACTUAL


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.state != "presenting":
        return None
    if not runtime.call("is_property_detail_request", runtime.user_text):
        return None

    session = runtime.session
    if not session.matched_record_ids:
        return None
    if session.current_match_index >= len(session.matched_record_ids):
        return None

    record_id = session.matched_record_ids[session.current_match_index]
    return IntentResult(response=await runtime.acall("show_property_by_id", record_id))

