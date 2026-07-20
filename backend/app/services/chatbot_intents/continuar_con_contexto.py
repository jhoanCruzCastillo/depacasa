"""Intent handler: continuar_con_contexto."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import CONTINUAR_CON_CONTEXTO


INTENT_NAME = CONTINUAR_CON_CONTEXTO


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.state != "collecting_info" or runtime.step != 8:
        return None

    text = (runtime.user_text or "").strip()
    if not text or not runtime.call("is_affirmative_message", text):
        return None

    current_criteria = runtime.call("clean_criteria", runtime.session.extracted_criteria)
    has_saved_criteria = runtime.call("has_actionable_criteria", current_criteria)
    if not has_saved_criteria:
        runtime.session.info_step = 4
        return IntentResult(
            response=runtime.call(
                "text_response",
                "Perfecto. Cuentame que propiedad buscas y comenzamos.",
            )
        )

    runtime.session.info_step = 5
    seed = runtime.session.ideal_description or text
    return IntentResult(response=await runtime.acall("start_search", seed))

