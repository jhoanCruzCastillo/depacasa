"""Twilio WhatsApp webhook endpoint."""

import logging
from fastapi import APIRouter, Request, Depends, BackgroundTasks
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db
from app.services.twilio_service import parse_incoming
from app.services.conversation import handle_incoming

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/webhook")
async def twilio_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    form = await request.form()
    data = parse_incoming(dict(form))

    logger.info(f"Webhook from={data['from']} body={data['body'][:80]!r}")

    if data["from"] and data["body"]:
        background_tasks.add_task(
            handle_incoming, data["from"], data["body"], data["message_sid"], db
        )

    # Return empty TwiML so Twilio doesn't retry
    return Response(
        content='<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        media_type="application/xml",
    )
