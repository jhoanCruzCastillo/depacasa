"""Intent handler: inicio_busqueda."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import INICIO_BUSQUEDA


INTENT_NAME = INICIO_BUSQUEDA


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    text = (runtime.user_text or "").strip()
    if not text:
        return None

    session = runtime.session
    step = runtime.step
    state = runtime.state

    # From contact_requested or presenting: escape into a new search when user shifts intent
    if state in {"contact_requested", "presenting"}:
        if runtime.call("looks_like_search_update", text):
            session.state = "collecting_info"
            session.info_step = 5
            return IntentResult(response=await runtime.acall("start_search", text))
        return None

    if state != "collecting_info":
        return None

    # In contact capture / financial doc steps: only escape when text clearly is a search
    if step in {9, 10, 12}:
        if runtime.call("looks_like_search_update", text):
            session.info_step = 5
            return IntentResult(response=await runtime.acall("start_search", text))
        return None

    if step == 11:
        if runtime.call("is_generic_adjust_request", text):
            return None
        if runtime.call("is_affirmative_message", text) or runtime.call("is_negative_message", text):
            return None
        session.info_step = 5
        return IntentResult(response=await runtime.acall("start_search", text))

    if step == 8:
        current_criteria = runtime.call("clean_criteria", session.extracted_criteria)
        has_saved_criteria = runtime.call("has_actionable_criteria", current_criteria)
        if runtime.call("is_affirmative_message", text):
            if has_saved_criteria:
                session.info_step = 5
                seed = session.ideal_description or text
                return IntentResult(response=await runtime.acall("start_search", seed))
            session.info_step = 4
            return IntentResult(
                response=runtime.call(
                    "text_response",
                    "Perfecto. Cuentame que estas buscando exactamente para iniciar la busqueda.",
                )
            )
        if runtime.call("looks_like_search_update", text):
            session.info_step = 5
            return IntentResult(response=await runtime.acall("start_search", text))
        return None

    if step != 4:
        return None

    if not runtime.call("is_scope_message", text):
        return None
    if runtime.call("is_new_unseen_request", text):
        return None
    if runtime.call("is_viewed_request", text):
        return None
    if runtime.call("is_interested_list_request", text):
        return None
    if runtime.call("is_generic_adjust_request", text):
        return None

    session.ideal_description = text
    session.info_step = 5
    return IntentResult(response=await runtime.acall("start_search", text))
