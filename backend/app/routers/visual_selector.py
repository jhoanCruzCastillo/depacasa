from typing import Any, Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.visual_selector_service import visual_selector_manager

router = APIRouter()


@router.websocket("/ws/visual-selector")
async def visual_selector_ws(websocket: WebSocket):
    await websocket.accept()
    session_id: Optional[str] = None
    try:
        while True:
            message: Dict[str, Any] = await websocket.receive_json()
            msg_type = message.get("type")

            try:
                if msg_type == "start_session":
                    url = message.get("url", "")
                    viewport = message.get("viewport") or {"width": 1280, "height": 720}
                    session = await visual_selector_manager.create_session(url, viewport)
                    session_id = session.id
                    # Always start from top so frontend scroll=0 matches page scroll=0
                    await visual_selector_manager.scroll_to(session.id, 0)
                    screenshot = await visual_selector_manager.screenshot(session.id)
                    await websocket.send_json({
                        "type": "session_started",
                        "session_id": session.id,
                        "viewport": session.viewport,
                        "url": session.url,
                        "screenshot": screenshot,
                    })
                elif msg_type == "scroll":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    scroll_y = int(message.get("scroll_y", 0))
                    screenshot = await visual_selector_manager.scroll_to(session, scroll_y)
                    await websocket.send_json({"type": "snapshot", "screenshot": screenshot})
                elif msg_type == "hover":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    await visual_selector_manager.hover_at(session, int(message.get("x", 0)), int(message.get("y", 0)))
                    screenshot = await visual_selector_manager.screenshot(session)
                    await websocket.send_json({"type": "snapshot", "screenshot": screenshot})
                elif msg_type == "free_click":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    screenshot = await visual_selector_manager.free_click(session, int(message.get("x", 0)), int(message.get("y", 0)))
                    await websocket.send_json({"type": "snapshot", "screenshot": screenshot})
                elif msg_type == "select":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    payload = await visual_selector_manager.select_at(session, int(message.get("x", 0)), int(message.get("y", 0)))
                    screenshot = await visual_selector_manager.screenshot(session)
                    await websocket.send_json({"type": "selection", "data": payload, "screenshot": screenshot})
                elif msg_type == "validate":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    card_selector = message.get("card_selector") or None
                    fields = message.get("fields") or []
                    result = await visual_selector_manager.validate_selectors(session, card_selector, fields)
                    errors = []
                    for item in result.get("results", []):
                        if item.get("total", 0) == 0 or item.get("found", 0) == 0:
                            errors.append(f"El selector '{item.get('selector')}' no encontró elementos.")
                    await websocket.send_json({"type": "validation_result", "data": result, "errors": errors})
                elif msg_type == "ai_generate":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    result = await visual_selector_manager.generate_ai_template(session)
                    await websocket.send_json({"type": "ai_result", "data": result})
                elif msg_type == "snapshot":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    screenshot = await visual_selector_manager.screenshot(session)
                    await websocket.send_json({"type": "snapshot", "screenshot": screenshot})
                elif msg_type == "end_session":
                    session = message.get("session_id") or session_id
                    if session:
                        await visual_selector_manager.close_session(session)
                    await websocket.send_json({"type": "session_closed"})
                else:
                    await websocket.send_json({"type": "error", "message": "Tipo de mensaje no soportado."})
            except Exception as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        if session_id:
            await visual_selector_manager.close_session(session_id)
