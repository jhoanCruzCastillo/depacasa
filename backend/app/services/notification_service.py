"""Create admin notifications for system events."""
from __future__ import annotations
import logging
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.admin_notification import AdminNotification

logger = logging.getLogger(__name__)


def create_notification(
    db: Session,
    type: str,
    title: str,
    body: str | None = None,
    reference_id: UUID | str | None = None,
    reference_type: str | None = None,
) -> None:
    """Insert a notification row. Non-fatal: swallows all errors."""
    try:
        ref = UUID(str(reference_id)) if reference_id else None
        notif = AdminNotification(
            type=type,
            title=title,
            body=body,
            reference_id=ref,
            reference_type=reference_type,
        )
        db.add(notif)
        db.commit()
    except Exception as exc:
        logger.warning("[notifications] failed to create: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
