"""Admin notifications endpoints."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from app.models.admin_notification import AdminNotification

router = APIRouter(prefix="/api/admin/notifications", tags=["admin-notifications"])


def _out(n: AdminNotification) -> dict:
    return {
        "id": str(n.id),
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "reference_id": str(n.reference_id) if n.reference_id else None,
        "reference_type": n.reference_type,
        "is_read": n.is_read,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("")
def list_notifications(limit: int = 50, db: Session = Depends(get_db)):
    items = (
        db.query(AdminNotification)
        .order_by(AdminNotification.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_out(n) for n in items]


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db)):
    count = (
        db.query(AdminNotification)
        .filter(AdminNotification.is_read == False)  # noqa: E712
        .count()
    )
    return {"count": count}


@router.patch("/{notif_id}/read")
def mark_read(notif_id: str, db: Session = Depends(get_db)):
    notif = db.query(AdminNotification).filter(AdminNotification.id == UUID(notif_id)).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Not found")
    notif.is_read = True
    notif.read_at = datetime.now(timezone.utc)
    db.commit()
    return _out(notif)


@router.post("/mark-all-read")
def mark_all_read(db: Session = Depends(get_db)):
    db.query(AdminNotification).filter(AdminNotification.is_read == False).update(  # noqa: E712
        {"is_read": True, "read_at": datetime.now(timezone.utc)},
        synchronize_session=False,
    )
    db.commit()
    return {"ok": True}
