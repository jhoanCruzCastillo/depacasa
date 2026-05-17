"""Intent routing and execution engine."""

from __future__ import annotations

from app.services.chatbot_intents.ajustar_criterios_busqueda import handle as handle_ajustar
from app.services.chatbot_intents.calificar_propiedad import handle as handle_calificar
from app.services.chatbot_intents.capturar_datos_contacto import handle as handle_capturar_contacto
from app.services.chatbot_intents.capturar_sustento_financiero import handle as handle_capturar_sustento
from app.services.chatbot_intents.confirmar_relajacion_resultados import handle as handle_confirmar_relajacion
from app.services.chatbot_intents.consultar_detalle_propiedad_actual import handle as handle_consultar_detalle
from app.services.chatbot_intents.continuar_con_contexto import handle as handle_continuar_contexto
from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.fallback_fuera_de_alcance import handle as handle_fallback_scope
from app.services.chatbot_intents.fallback_no_entendido import handle as handle_fallback_unknown
from app.services.chatbot_intents.inicio_busqueda import handle as handle_inicio_busqueda
from app.services.chatbot_intents.marcar_interes_lo_quiero import handle as handle_marcar_interes
from app.services.chatbot_intents.types import (
    AJUSTAR_CRITERIOS_BUSQUEDA,
    CALIFICAR_PROPIEDAD,
    CAPTURAR_DATOS_CONTACTO,
    CAPTURAR_SUSTENTO_FINANCIERO,
    CONFIRMAR_RELAJACION_RESULTADOS,
    CONSULTAR_DETALLE_PROPIEDAD_ACTUAL,
    CONTINUAR_CON_CONTEXTO,
    FALLBACK_FUERA_DE_ALCANCE,
    FALLBACK_NO_ENTENDIDO,
    INICIO_BUSQUEDA,
    MARCAR_INTERES_LO_QUIERO,
    VER_PROPIEDADES_NUEVAS_NO_VISTAS,
    VER_PROPIEDADES_VISTAS,
    VER_SIGUIENTE_PROPIEDAD,
)
from app.services.chatbot_intents.ver_propiedades_nuevas_no_vistas import handle as handle_ver_nuevas
from app.services.chatbot_intents.ver_propiedades_vistas import handle as handle_ver_vistas
from app.services.chatbot_intents.ver_siguiente_propiedad import handle as handle_siguiente


_REGISTRY = {
    INICIO_BUSQUEDA: handle_inicio_busqueda,
    CONTINUAR_CON_CONTEXTO: handle_continuar_contexto,
    VER_PROPIEDADES_NUEVAS_NO_VISTAS: handle_ver_nuevas,
    VER_PROPIEDADES_VISTAS: handle_ver_vistas,
    AJUSTAR_CRITERIOS_BUSQUEDA: handle_ajustar,
    CONFIRMAR_RELAJACION_RESULTADOS: handle_confirmar_relajacion,
    VER_SIGUIENTE_PROPIEDAD: handle_siguiente,
    CALIFICAR_PROPIEDAD: handle_calificar,
    MARCAR_INTERES_LO_QUIERO: handle_marcar_interes,
    CAPTURAR_DATOS_CONTACTO: handle_capturar_contacto,
    CAPTURAR_SUSTENTO_FINANCIERO: handle_capturar_sustento,
    CONSULTAR_DETALLE_PROPIEDAD_ACTUAL: handle_consultar_detalle,
    FALLBACK_FUERA_DE_ALCANCE: handle_fallback_scope,
    FALLBACK_NO_ENTENDIDO: handle_fallback_unknown,
}


def candidate_intents_for_state(state: str, step: int | None) -> list[str]:
    """Return the intent candidates enabled for the current state/step."""
    if state == "collecting_info":
        if step == 8:
            return [
                CONTINUAR_CON_CONTEXTO,
                AJUSTAR_CRITERIOS_BUSQUEDA,
                VER_PROPIEDADES_NUEVAS_NO_VISTAS,
                VER_PROPIEDADES_VISTAS,
                INICIO_BUSQUEDA,
                FALLBACK_FUERA_DE_ALCANCE,
                FALLBACK_NO_ENTENDIDO,
            ]
        if step == 6:
            return [
                AJUSTAR_CRITERIOS_BUSQUEDA,
                CONFIRMAR_RELAJACION_RESULTADOS,
                INICIO_BUSQUEDA,
                FALLBACK_FUERA_DE_ALCANCE,
                FALLBACK_NO_ENTENDIDO,
            ]
        if step == 11:
            return [
                AJUSTAR_CRITERIOS_BUSQUEDA,
                INICIO_BUSQUEDA,
                FALLBACK_FUERA_DE_ALCANCE,
                FALLBACK_NO_ENTENDIDO,
            ]
        if step in {9, 10}:
            return [
                CAPTURAR_DATOS_CONTACTO,
                FALLBACK_NO_ENTENDIDO,
            ]
        if step == 12:
            return [
                CAPTURAR_SUSTENTO_FINANCIERO,
                FALLBACK_NO_ENTENDIDO,
            ]
        return [
            AJUSTAR_CRITERIOS_BUSQUEDA,
            VER_PROPIEDADES_NUEVAS_NO_VISTAS,
            VER_PROPIEDADES_VISTAS,
            INICIO_BUSQUEDA,
            FALLBACK_FUERA_DE_ALCANCE,
            FALLBACK_NO_ENTENDIDO,
        ]

    if state == "presenting":
        return [
            CALIFICAR_PROPIEDAD,
            VER_SIGUIENTE_PROPIEDAD,
            MARCAR_INTERES_LO_QUIERO,
            CONSULTAR_DETALLE_PROPIEDAD_ACTUAL,
            AJUSTAR_CRITERIOS_BUSQUEDA,
            VER_PROPIEDADES_VISTAS,
            INICIO_BUSQUEDA,
            FALLBACK_FUERA_DE_ALCANCE,
            FALLBACK_NO_ENTENDIDO,
        ]

    if state == "contact_requested":
        return [
            VER_PROPIEDADES_VISTAS,
            FALLBACK_NO_ENTENDIDO,
        ]

    return [FALLBACK_NO_ENTENDIDO]


def _merge_preludes(response: dict, preludes: list[str]) -> dict:
    if not preludes:
        return response
    message = str(response.get("message") or "").strip()
    prelude_text = "\n".join(part.strip() for part in preludes if part and part.strip())
    if not prelude_text:
        return response
    merged = dict(response)
    merged["message"] = f"{prelude_text}\n\n{message}" if message else prelude_text
    return merged


async def _rank_candidates(runtime: IntentRuntime, candidates: list[str]) -> list[str]:
    """Rank candidates using Claude with a deterministic local fallback."""
    if not candidates:
        return []
    try:
        from app.services.claude_service import rank_intents

        ranked = await rank_intents(
            message=runtime.user_text,
            candidates=candidates,
            state=runtime.state,
            step=runtime.step,
        )
        if ranked:
            return [intent for intent in ranked if intent in candidates]
    except Exception:
        # Fallback handled below.
        pass
    return candidates


async def dispatch_intents(runtime: IntentRuntime, candidates: list[str]) -> dict | None:
    """Execute intents in ranked order until a response is produced."""
    ordered = await _rank_candidates(runtime, candidates)
    if not ordered:
        return None

    executed: list[str] = []
    final_response: dict | None = None

    for intent_name in ordered:
        handler = _REGISTRY.get(intent_name)
        if handler is None:
            continue
        raw_result = await handler(runtime)
        if raw_result is None:
            continue

        result = raw_result if isinstance(raw_result, IntentResult) else IntentResult(response=raw_result)
        executed.append(intent_name)
        if result.response is not None:
            final_response = result.response
        if not result.continue_processing:
            break

    if final_response is None:
        return None

    final_response = _merge_preludes(final_response, list(runtime.metadata.get("prelude_messages") or []))
    final_response["intent_trace"] = executed
    return final_response
