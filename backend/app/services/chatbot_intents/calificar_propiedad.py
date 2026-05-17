"""Intent handler: calificar_propiedad."""

from __future__ import annotations

from app.services.chatbot_intents.context import IntentResult, IntentRuntime
from app.services.chatbot_intents.types import CALIFICAR_PROPIEDAD


INTENT_NAME = CALIFICAR_PROPIEDAD


async def handle(runtime: IntentRuntime) -> IntentResult | None:
    if runtime.state != "presenting":
        return None

    session = runtime.session
    rating = runtime.call("extract_rating_from_text", runtime.user_text)
    if not rating or not session.site_user_id or not session.matched_record_ids:
        return None

    feedback = runtime.call("rate_current_property", rating)
    if runtime.call("wants_next_property", runtime.user_text):
        prelude = list(runtime.metadata.get("prelude_messages") or [])
        prelude.append(feedback)
        runtime.metadata["prelude_messages"] = prelude
        return IntentResult(continue_processing=True)

    return IntentResult(response=runtime.call("text_response", feedback))

