"""Intent handler: confirmar_relajacion_resultados."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import CONFIRMAR_RELAJACION_RESULTADOS


INTENT_NAME = CONFIRMAR_RELAJACION_RESULTADOS


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.state != "collecting_info" or runtime.step != 6:
        return None

    text = (runtime.user_text or "").strip()
    session = runtime.session

    if runtime.call("is_affirmative_message", text) and session.matched_record_ids:
        session.state = "presenting"
        session.info_step = 7
        return IntentResult(response=await runtime.acall("show_property_by_id", session.matched_record_ids[0]))

    if runtime.call("looks_like_search_update", text):
        session.matched_record_ids = []
        session.current_match_index = 0
        session.info_step = 5
        return IntentResult(response=await runtime.acall("start_search", text))

    session.matched_record_ids = []
    session.current_match_index = 0
    session.info_step = 4
    return IntentResult(
        response=runtime.call(
            "text_response",
            "Entendido. Mantendre los filtros actuales. "
            "Si quieres, dime que ajustamos (zona, dormitorios, presupuesto).",
        )
    )

