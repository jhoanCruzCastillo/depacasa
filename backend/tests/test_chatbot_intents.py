from __future__ import annotations

import os
from types import SimpleNamespace

import pytest

os.environ["DEBUG"] = "false"

from app.services import claude_service
from app.services.chatbot_intents import (
    ajustar_criterios_busqueda,
    calificar_propiedad,
    capturar_datos_contacto,
    capturar_sustento_financiero,
    confirmar_relajacion_resultados,
    consultar_detalle_propiedad_actual,
    continuar_con_contexto,
    fallback_fuera_de_alcance,
    fallback_no_entendido,
    inicio_busqueda,
    marcar_interes_lo_quiero,
    ver_propiedades_nuevas_no_vistas,
    ver_propiedades_vistas,
    ver_siguiente_propiedad,
)
from app.services.chatbot_intents.context import IntentRuntime
from app.services.chatbot_intents.engine import dispatch_intents
from app.services.chatbot_intents.types import CALIFICAR_PROPIEDAD, FALLBACK_NO_ENTENDIDO, VER_SIGUIENTE_PROPIEDAD


def _text_response(message: str) -> dict:
    return {"message": message, "card": None, "state": "collecting_info"}


def _extract_rating(text: str) -> int | None:
    norm = (text or "").lower()
    if "5" in norm:
        return 5
    if "4" in norm:
        return 4
    if "3" in norm:
        return 3
    if "2" in norm:
        return 2
    if "1" in norm:
        return 1
    return None


def build_runtime(
    *,
    state: str,
    step: int,
    text: str,
    extracted_criteria: dict | None = None,
    site_user_id: str | None = "user-1",
    helper_overrides: dict | None = None,
) -> tuple[IntentRuntime, dict]:
    calls: dict = {
        "start_search": [],
        "show_property_by_id": [],
        "rate_current_property": [],
    }
    session = SimpleNamespace(
        state=state,
        info_step=step,
        extracted_criteria=extracted_criteria or {},
        site_user_id=site_user_id,
        matched_record_ids=["rec-1", "rec-2"],
        current_match_index=0,
        ideal_description="depa en miraflores",
        name="Anton",
        country=None,
        phone=None,
    )

    async def _start_search(description: str) -> dict:
        calls["start_search"].append(description)
        return {"message": f"SEARCH:{description}", "card": None, "state": "presenting"}

    async def _show_interested() -> dict:
        return {"message": "INTERESTED", "card": None, "state": "presenting"}

    async def _show_property_by_id(record_id: str) -> dict:
        calls["show_property_by_id"].append(record_id)
        return {
            "message": f"PROPERTY:{record_id}",
            "card": {"record_id": record_id},
            "state": "presenting",
        }

    async def _next_property() -> dict:
        return {"message": "NEXT", "card": {"record_id": "rec-2"}, "state": "presenting"}

    async def _contact_capture() -> dict:
        return _text_response("CONTACT_CAPTURED")

    async def _financial_doc_capture() -> dict:
        return _text_response("FINANCIAL_DOC_CAPTURED")

    def _rate_current_property(rating: int) -> str:
        calls["rate_current_property"].append(rating)
        return f"RATED:{rating}"

    helpers = {
        "text_response": _text_response,
        "fallback_out_of_scope": lambda: _text_response("OUT_OF_SCOPE"),
        "fallback_not_understood": lambda: _text_response("NOT_UNDERSTOOD"),
        "normalize_text": lambda x: (x or "").lower(),
        "is_scope_message": lambda x: "clima" not in (x or "").lower(),
        "is_new_unseen_request": lambda x: "no vistas" in (x or "").lower(),
        "is_viewed_request": lambda x: "vistas" in (x or "").lower(),
        "is_interested_list_request": lambda x: "interes" in (x or "").lower(),
        "is_adjust_search_intent": lambda x: "ajust" in (x or "").lower(),
        "is_generic_adjust_request": lambda x: "ajust" in (x or "").lower(),
        "is_mark_current_property_interest": lambda x: "lo quiero" in (x or "").lower(),
        "looks_like_search_update": lambda x: any(
            token in (x or "").lower()
            for token in ["busco", "zona", "precio", "presupuesto", "dormitorio", "departamento"]
        ),
        "is_affirmative_message": lambda x: (x or "").strip().lower() in {"si", "sí", "ok", "dale", "adelante"},
        "is_negative_message": lambda x: (x or "").strip().lower().startswith("no"),
        "extract_rating_from_text": _extract_rating,
        "wants_next_property": lambda x: "siguiente" in (x or "").lower(),
        "is_property_detail_request": lambda x: "detalle" in (x or "").lower(),
        "clean_criteria": lambda criteria: {
            k: v for k, v in (criteria or {}).items() if not str(k).startswith("_")
        },
        "has_actionable_criteria": lambda criteria: bool(criteria),
        "summarize_preferences": lambda criteria: "resumen",
        "get_exhausted_revisit_ids": lambda ctx: list((ctx or {}).get("_exhausted_unseen_ids") or []),
        "get_viewed_ranked_ids": lambda user_id: [],
        "rate_current_property": _rate_current_property,
        "mark_interest": lambda msg: _text_response("INTEREST_MARKED"),
        "start_search": _start_search,
        "show_interested_properties": _show_interested,
        "show_property_by_id": _show_property_by_id,
        "next_property": _next_property,
        "handle_contact_capture_step": _contact_capture,
        "handle_financial_document_step": _financial_doc_capture,
    }
    if helper_overrides:
        helpers.update(helper_overrides)

    runtime = IntentRuntime(
        session=session,
        db=SimpleNamespace(),
        user_text=text,
        state=state,
        step=step,
        ctx=session.extracted_criteria,
        helpers=helpers,
    )
    return runtime, calls


@pytest.mark.asyncio
async def test_inicio_busqueda_starts_search():
    runtime, calls = build_runtime(state="collecting_info", step=4, text="Busco departamento en Surco")
    result = await inicio_busqueda.handle(runtime)
    assert result is not None
    assert calls["start_search"] == ["Busco departamento en Surco"]
    assert runtime.session.info_step == 5


@pytest.mark.asyncio
async def test_continuar_con_contexto_uses_saved_description():
    runtime, calls = build_runtime(
        state="collecting_info",
        step=8,
        text="si",
        extracted_criteria={"location": "Miraflores"},
    )
    result = await continuar_con_contexto.handle(runtime)
    assert result is not None
    assert calls["start_search"] == ["depa en miraflores"]


@pytest.mark.asyncio
async def test_ver_propiedades_nuevas_no_vistas_sets_result_mode():
    runtime, calls = build_runtime(
        state="collecting_info",
        step=4,
        text="quiero ver propiedades no vistas",
        extracted_criteria={"location": "Surco"},
    )
    result = await ver_propiedades_nuevas_no_vistas.handle(runtime)
    assert result is not None
    assert runtime.session.extracted_criteria["_result_mode"] == "new_unseen"
    assert calls["start_search"]


@pytest.mark.asyncio
async def test_ver_propiedades_vistas_uses_exhausted_pool_first():
    runtime, calls = build_runtime(
        state="collecting_info",
        step=4,
        text="quiero ver las vistas",
        extracted_criteria={"_exhausted_unseen_ids": ["rec-x", "rec-y"]},
    )
    result = await ver_propiedades_vistas.handle(runtime)
    assert result is not None
    assert calls["show_property_by_id"] == ["rec-x"]
    assert runtime.session.state == "presenting"


@pytest.mark.asyncio
async def test_ajustar_criterios_moves_to_adjust_step():
    runtime, _ = build_runtime(state="collecting_info", step=4, text="quiero ajustar filtros")
    result = await ajustar_criterios_busqueda.handle(runtime)
    assert result is not None
    assert runtime.session.info_step == 11


@pytest.mark.asyncio
async def test_confirmar_relajacion_accepts_and_shows_property():
    runtime, calls = build_runtime(state="collecting_info", step=6, text="si")
    result = await confirmar_relajacion_resultados.handle(runtime)
    assert result is not None
    assert calls["show_property_by_id"] == ["rec-1"]
    assert runtime.session.state == "presenting"


@pytest.mark.asyncio
async def test_ver_siguiente_propiedad():
    runtime, _ = build_runtime(state="presenting", step=7, text="siguiente")
    result = await ver_siguiente_propiedad.handle(runtime)
    assert result is not None
    assert result.response["message"] == "NEXT"


@pytest.mark.asyncio
async def test_calificar_propiedad():
    runtime, calls = build_runtime(state="presenting", step=7, text="le doy 2 estrellas")
    result = await calificar_propiedad.handle(runtime)
    assert result is not None
    assert result.response["message"] == "RATED:2"
    assert calls["rate_current_property"] == [2]


@pytest.mark.asyncio
async def test_marcar_interes_lo_quiero():
    runtime, _ = build_runtime(state="presenting", step=7, text="lo quiero")
    result = await marcar_interes_lo_quiero.handle(runtime)
    assert result is not None
    assert result.response["message"] == "INTEREST_MARKED"


@pytest.mark.asyncio
async def test_capturar_datos_contacto_calls_step_handler():
    runtime, _ = build_runtime(state="collecting_info", step=10, text="mi whatsapp es 999111222")
    result = await capturar_datos_contacto.handle(runtime)
    assert result is not None
    assert result.response["message"] == "CONTACT_CAPTURED"


@pytest.mark.asyncio
async def test_capturar_sustento_financiero_calls_step_handler():
    runtime, _ = build_runtime(state="collecting_info", step=12, text="te comparto el enlace")
    result = await capturar_sustento_financiero.handle(runtime)
    assert result is not None
    assert result.response["message"] == "FINANCIAL_DOC_CAPTURED"


@pytest.mark.asyncio
async def test_consultar_detalle_propiedad_actual():
    runtime, calls = build_runtime(state="presenting", step=7, text="dame detalle")
    result = await consultar_detalle_propiedad_actual.handle(runtime)
    assert result is not None
    assert calls["show_property_by_id"] == ["rec-1"]


@pytest.mark.asyncio
async def test_fallback_fuera_de_alcance():
    runtime, _ = build_runtime(
        state="collecting_info",
        step=4,
        text="como esta el clima hoy",
    )
    result = await fallback_fuera_de_alcance.handle(runtime)
    assert result is not None
    assert result.response["message"] == "OUT_OF_SCOPE"


@pytest.mark.asyncio
async def test_fallback_no_entendido():
    runtime, _ = build_runtime(state="collecting_info", step=4, text="...")
    result = await fallback_no_entendido.handle(runtime)
    assert result is not None
    assert result.response["message"] == "NOT_UNDERSTOOD"


@pytest.mark.asyncio
async def test_dispatch_multi_intent_rating_then_next(monkeypatch):
    runtime, calls = build_runtime(state="presenting", step=7, text="le doy 2 estrellas y siguiente")

    async def _fake_rank(*args, **kwargs):
        return [CALIFICAR_PROPIEDAD, VER_SIGUIENTE_PROPIEDAD, FALLBACK_NO_ENTENDIDO]

    monkeypatch.setattr("app.services.chatbot_intents.engine._rank_candidates", _fake_rank)

    result = await dispatch_intents(runtime, [CALIFICAR_PROPIEDAD, VER_SIGUIENTE_PROPIEDAD, FALLBACK_NO_ENTENDIDO])
    assert result is not None
    assert calls["rate_current_property"] == [2]
    assert result["message"].startswith("RATED:2")
    assert "NEXT" in result["message"]
    assert result["intent_trace"][:2] == [CALIFICAR_PROPIEDAD, VER_SIGUIENTE_PROPIEDAD]


@pytest.mark.asyncio
async def test_rank_intents_fallback_multi_intent_order(monkeypatch):
    class _BrokenClient:
        class messages:
            @staticmethod
            def create(*args, **kwargs):
                raise RuntimeError("force fallback")

    monkeypatch.setattr(claude_service, "_get_client", lambda: _BrokenClient())

    ordered = await claude_service.rank_intents(
        message="le doy 2 estrellas y siguiente",
        candidates=[CALIFICAR_PROPIEDAD, VER_SIGUIENTE_PROPIEDAD, FALLBACK_NO_ENTENDIDO],
        state="presenting",
        step=7,
    )
    assert ordered[0] == CALIFICAR_PROPIEDAD
    assert VER_SIGUIENTE_PROPIEDAD in ordered
