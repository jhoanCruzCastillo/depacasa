"""Intent handler: ver_propiedades_vistas."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import VER_PROPIEDADES_VISTAS


INTENT_NAME = VER_PROPIEDADES_VISTAS


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    text = (runtime.user_text or "").strip()
    session = runtime.session

    # Keep compatibility with "mis propiedades de interes" in every state.
    if session.site_user_id and runtime.call("is_interested_list_request", text):
        return IntentResult(response=await runtime.acall("show_interested_properties"))

    if runtime.state not in {"collecting_info", "presenting", "contact_requested"}:
        return None

    if not runtime.call("is_viewed_request", text):
        return None

    exhausted_revisit_ids = runtime.call("get_exhausted_revisit_ids", runtime.ctx)
    if exhausted_revisit_ids:
        session.matched_record_ids = exhausted_revisit_ids
        session.current_match_index = 0
        session.state = "presenting"
        session.info_step = 7
        return IntentResult(response=await runtime.acall("show_property_by_id", exhausted_revisit_ids[0]))

    if not session.site_user_id:
        return None

    viewed_ids = runtime.call("get_viewed_ranked_ids", session.site_user_id)
    if not viewed_ids:
        if runtime.step == 8:
            msg = "Aun no tengo propiedades vistas para mostrarte. ¿Buscamos opciones nuevas?"
        else:
            msg = (
                "Aun no tienes propiedades vistas registradas. "
                "Si quieres, te muestro propiedades nuevas con tus preferencias actuales."
            )
        return IntentResult(response=runtime.call("text_response", msg))

    session.matched_record_ids = viewed_ids
    session.current_match_index = 0
    session.state = "presenting"
    session.info_step = 7
    return IntentResult(response=await runtime.acall("show_property_by_id", viewed_ids[0]))

