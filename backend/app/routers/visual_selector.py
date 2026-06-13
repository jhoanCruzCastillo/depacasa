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
                elif msg_type == "hover_element":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    screenshot = await visual_selector_manager.hover_coords(
                        session,
                        int(message.get("x", 0)),
                        int(message.get("y", 0)),
                        int(message.get("wait_ms", 700)),
                    )
                    await websocket.send_json({"type": "snapshot", "screenshot": screenshot})
                elif msg_type == "hover_scan":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    screenshot = await visual_selector_manager.scan_and_hover(
                        session,
                        int(message.get("x1", 0)),
                        int(message.get("y1", 0)),
                        int(message.get("x2", 0)),
                        int(message.get("y2", 0)),
                    )
                    await websocket.send_json({"type": "snapshot", "screenshot": screenshot})
                elif msg_type == "hover_reset":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    # Move mouse off-screen to deactivate all hover states
                    screenshot = await visual_selector_manager.hover_coords(
                        session, x=0, y=0, wait_ms=200
                    )
                    await websocket.send_json({"type": "snapshot", "screenshot": screenshot})
                elif msg_type == "select_rect":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    payload = await visual_selector_manager.select_rect(
                        session,
                        int(message.get("x1", 0)),
                        int(message.get("y1", 0)),
                        int(message.get("x2", 0)),
                        int(message.get("y2", 0)),
                        hover=bool(message.get("hover", False)),
                    )
                    screenshot = await visual_selector_manager.screenshot(session)
                    await websocket.send_json({"type": "rect_selected", "data": payload, "screenshot": screenshot})
                elif msg_type == "infer_field":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    result = await visual_selector_manager.infer_field_from_label(
                        session,
                        selector=message.get("selector", ""),
                        label=message.get("label", ""),
                        parent_label=message.get("parent_label") or None,
                    )
                    await websocket.send_json({"type": "field_inferred", "data": result})
                elif msg_type == "open_detail":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    url = message.get("url", "")
                    screenshot = await visual_selector_manager.open_detail_tab(session, url)
                    await websocket.send_json({"type": "detail_opened", "screenshot": screenshot, "url": url})
                elif msg_type == "switch_tab":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    tab = message.get("tab", "listing")
                    screenshot = await visual_selector_manager.switch_tab(session, tab)
                    await websocket.send_json({"type": "tab_switched", "tab": tab, "screenshot": screenshot})
                elif msg_type == "get_card_url":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    url = await visual_selector_manager.get_card_url(
                        session,
                        int(message.get("x", 0)),
                        int(message.get("y", 0)),
                    )
                    await websocket.send_json({"type": "card_url", "url": url})
                elif msg_type == "capture_rect":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    result = await visual_selector_manager.capture_and_analyze_rect(
                        session,
                        int(message.get("x1", 0)),
                        int(message.get("y1", 0)),
                        int(message.get("x2", 0)),
                        int(message.get("y2", 0)),
                        hover=bool(message.get("hover", False)),
                        context=str(message.get("context", "")),
                        ai_model=str(message.get("ai_model", "")),
                    )
                    screenshot = await visual_selector_manager.screenshot(session)
                    await websocket.send_json({"type": "capture_result", "data": result, "screenshot": screenshot})
                elif msg_type == "extract_raw_data":
                    session = message.get("session_id") or session_id
                    if not session:
                        raise RuntimeError("Sesión no inicializada")
                    result = await visual_selector_manager.validate_selectors(
                        session,
                        message.get("card_selector") or None,
                        message.get("fields") or [],
                    )
                    await websocket.send_json({"type": "raw_data", "data": result})
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
