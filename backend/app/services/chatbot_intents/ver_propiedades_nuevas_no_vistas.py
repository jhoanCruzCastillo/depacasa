"""Intent handler: ver_propiedades_nuevas_no_vistas."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import VER_PROPIEDADES_NUEVAS_NO_VISTAS


INTENT_NAME = VER_PROPIEDADES_NUEVAS_NO_VISTAS


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    state = runtime.state
    # Allow from collecting_info (steps 4/8/13), presenting, or contact_requested
    allowed = (
        (state == "collecting_info" and runtime.step in {4, 8, 13})
        or state in {"presenting", "contact_requested"}
    )
    if not allowed:
        return None

    text = (runtime.user_text or "").strip()
    session = runtime.session

    if not session.site_user_id:
        return None
    if not runtime.call("is_new_unseen_request", text):
        return None

    clean = runtime.call("clean_criteria", session.extracted_criteria)
    session.extracted_criteria = {**clean, "_result_mode": "new_unseen"}
    session.state = "collecting_info"
    session.info_step = 5

    seed = text if runtime.call("looks_like_search_update", text) else (session.ideal_description or text)
    return IntentResult(response=await runtime.acall("start_search", seed))

