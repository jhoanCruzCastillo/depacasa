"""Intent handler: ajustar_criterios_busqueda."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import AJUSTAR_CRITERIOS_BUSQUEDA


INTENT_NAME = AJUSTAR_CRITERIOS_BUSQUEDA


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    text = (runtime.user_text or "").strip()
    session = runtime.session
    step = runtime.step

    # From presenting or contact_requested: ask for adjustment params and switch state
    if runtime.state in {"presenting", "contact_requested"} and runtime.call("is_generic_adjust_request", text):
        session.state = "collecting_info"
        session.info_step = 11
        return IntentResult(
            response=runtime.call(
                "text_response",
                "Perfecto. Antes de buscar de nuevo, comparteme los parametros que quieres ajustar "
                "(zona/ciudad, dormitorios, presupuesto, etc.).",
            )
        )

    if runtime.state != "collecting_info":
        return None

    # In contact capture / financial doc steps: escape to adjustment flow
    if step in {9, 10, 12} and runtime.call("is_generic_adjust_request", text):
        session.info_step = 11
        return IntentResult(
            response=runtime.call(
                "text_response",
                "Perfecto. Indicame los cambios que quieres aplicar "
                "(zona/ciudad, dormitorios, presupuesto, etc.).",
            )
        )

    if step in {4, 8}:
        if runtime.call("is_generic_adjust_request", text):
            session.info_step = 11
            msg = (
                "Perfecto. Indicame los cambios que quieres aplicar "
                "(zona/ciudad, dormitorios, presupuesto, etc.)."
                if step == 8
                else "Perfecto. Indicame los nuevos parametros para ajustar la busqueda "
                "(por ejemplo: zona/ciudad, dormitorios o presupuesto)."
            )
            return IntentResult(response=runtime.call("text_response", msg))

        exhausted_revisit_ids = runtime.call("get_exhausted_revisit_ids", runtime.ctx)
        if exhausted_revisit_ids and runtime.call("is_adjust_search_intent", text):
            if step == 8:
                session.info_step = 4
            return IntentResult(
                response=runtime.call(
                    "text_response",
                    "Perfecto. Dime que quieres ajustar (zona, dormitorios, presupuesto o caracteristicas) "
                    "y busco nuevas opciones.",
                )
            )

    if step == 6 and runtime.call("is_generic_adjust_request", text):
        session.matched_record_ids = []
        session.current_match_index = 0
        session.info_step = 11
        return IntentResult(
            response=runtime.call(
                "text_response",
                "Perfecto. Dime que parametros quieres cambiar y hago el ajuste.",
            )
        )

    if step == 13:
        if runtime.call("is_generic_adjust_request", text):
            session.info_step = 11
            return IntentResult(
                response=runtime.call(
                    "text_response",
                    "Claro. Indicame los parametros que quieres ajustar "
                    "(zona/ciudad, dormitorios, presupuesto, etc.).",
                )
            )
        return None

    if step != 11:
        return None

    if not text:
        return IntentResult(
            response=runtime.call(
                "text_response",
                "Te leo. Comparteme los nuevos parametros para ajustar la busqueda "
                "(zona/ciudad, dormitorios, presupuesto, etc.).",
            )
        )

    if (
        runtime.call("is_generic_adjust_request", text)
        or runtime.call("is_affirmative_message", text)
        or runtime.call("is_negative_message", text)
    ):
        return IntentResult(
            response=runtime.call(
                "text_response",
                "Perfecto, quedo atento. Escribeme los parametros concretos que quieres ajustar "
                "(por ejemplo: 'zona Arequipa, 3 dormitorios, hasta 450000').",
            )
        )

    session.info_step = 5
    return IntentResult(response=await runtime.acall("start_search", text))

