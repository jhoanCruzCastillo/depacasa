"""Intent handler: filtro_exacto_propiedades.

Handles explicit filter requests such as:
- "Dame las propiedades que califiqué con muchas estrellas"
- "Muéstrame propiedades con pocas estrellas"
- "Dame propiedades con 3 estrellas"
- "Propiedades sin precio conocido"
- "Dame la propiedad con ID 6c02..."
"""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import FILTRO_EXACTO_PROPIEDADES

INTENT_NAME = FILTRO_EXACTO_PROPIEDADES


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    text = (runtime.user_text or "").strip()
    session = runtime.session

    filter_spec = runtime.call("detect_exact_filter", text)
    if not filter_spec:
        return None

    filter_type = filter_spec["type"]

    # ── by_id: fetch exact property by UUID ──────────────────────────────────
    if filter_type == "by_id":
        record_id = filter_spec["record_id"]
        prev_ctx = dict(session.extracted_criteria or {})
        prev_list = list(session.matched_record_ids or [])
        prev_index = session.current_match_index or 0
        prev_list_mode = prev_ctx.get("_list_mode")

        # Only suspend if we're interrupting an active multi-item search result
        has_suspendable_list = (
            runtime.state == "presenting"
            and len(prev_list) > 1
            and prev_list_mode != "by_id"
        )

        ctx = {k: v for k, v in prev_ctx.items() if k != "_suspended_list"}
        if has_suspendable_list:
            ctx["_suspended_list"] = {
                "ids": prev_list,
                "index": prev_index,
                "list_mode": prev_list_mode,
            }
        ctx["_list_mode"] = "by_id"
        session.extracted_criteria = ctx
        session.matched_record_ids = [record_id]
        session.current_match_index = 0
        session.state = "presenting"
        session.info_step = 7

        response = await runtime.acall("show_property_by_id", record_id)

        if has_suspendable_list:
            response = dict(response)
            msg = (response.get("message") or "").strip()
            if prev_list_mode == "filtered_by_rating":
                resume_q = "¿Seguimos con tus propiedades calificadas?"
            elif prev_list_mode == "interested":
                resume_q = "¿Seguimos viendo tus propiedades de interés?"
            else:
                resume_q = "¿Seguimos con las propiedades que estabamos revisando?"
            response["message"] = msg + "\n\n" + resume_q
            session.state = "collecting_info"
            session.info_step = 13
            response["state"] = "collecting_info"

        return IntentResult(response=response)

    # ── by_rating: filter by star rating ─────────────────────────────────────
    if filter_type == "by_rating":
        if not session.site_user_id:
            return IntentResult(response=runtime.call(
                "text_response",
                "Para ver tus propiedades calificadas necesito que estes registrado en la plataforma. "
                "Si quieres, puedo buscarte propiedades nuevas.",
            ))

        min_r = filter_spec.get("min_rating")
        max_r = filter_spec.get("max_rating")
        label = filter_spec.get("label", "calificadas")

        ids = runtime.call("get_properties_by_rating_filter", session.site_user_id, min_r, max_r)

        if not ids:
            return IntentResult(response=runtime.call(
                "text_response",
                f"No encontre propiedades con {label} en tu historial. "
                "Recuerda que solo aparecen aqui las propiedades que hayas visto y calificado. "
                "¿Buscamos opciones nuevas?",
            ))

        ctx = dict(session.extracted_criteria or {})
        ctx["_list_mode"] = "filtered_by_rating"
        ctx["_list_label"] = label
        ctx["_list_count"] = len(ids)
        session.extracted_criteria = ctx
        session.matched_record_ids = ids
        session.current_match_index = 0
        session.state = "presenting"
        session.info_step = 7

        return IntentResult(response=await runtime.acall("show_property_by_id", ids[0]))

    # ── no_price: filter properties without a known price ────────────────────
    if filter_type == "no_price":
        ids = runtime.call("get_properties_without_price")

        if not ids:
            return IntentResult(response=runtime.call(
                "text_response",
                "Todas las propiedades disponibles tienen precio conocido. "
                "¿Te busco algo con un rango de precio especifico?",
            ))

        ctx = dict(session.extracted_criteria or {})
        ctx["_list_mode"] = "filtered_no_price"
        ctx["_list_count"] = len(ids)
        session.extracted_criteria = ctx
        session.matched_record_ids = ids
        session.current_match_index = 0
        session.state = "presenting"
        session.info_step = 7

        return IntentResult(response=await runtime.acall("show_property_by_id", ids[0]))

    return None
