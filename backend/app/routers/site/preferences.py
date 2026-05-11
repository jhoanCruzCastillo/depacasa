"""User preferences, property ratings, and search history — public API."""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.routers.auth import get_optional_user
from database import get_db

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class RateIn(BaseModel):
    record_id: str
    rating: int        # 1–5
    interested: bool = False


class SearchHistoryIn(BaseModel):
    query: Optional[str] = None
    location: Optional[str] = None
    project_id: Optional[str] = None
    source: str = "portal"   # 'portal' | 'chatbot'


# ── Rate a property ───────────────────────────────────────────────────────────

@router.post("/rate")
def rate_property(body: RateIn, request: Request, db: Session = Depends(get_db)):
    user = get_optional_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Autenticación requerida.")

    from app.models.user_property_interaction import UserPropertyInteraction

    try:
        record_uuid = UUID(body.record_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="record_id inválido.")

    row = db.query(UserPropertyInteraction).filter_by(
        site_user_id=user.id, record_id=record_uuid
    ).first()
    if not row:
        row = UserPropertyInteraction(site_user_id=user.id, record_id=record_uuid)
        db.add(row)

    row.rating = max(1, min(5, body.rating))
    row.rated_at = datetime.now(timezone.utc)
    if body.interested:
        row.interested = True

    db.commit()
    return {"ok": True, "rating": row.rating}


# ── Save a search ─────────────────────────────────────────────────────────────

@router.post("/search-history")
def save_search(body: SearchHistoryIn, request: Request, db: Session = Depends(get_db)):
    user = get_optional_user(request, db)
    if not user:
        return {"ok": False, "reason": "anonymous"}

    if not (body.query or body.location or body.project_id):
        return {"ok": False, "reason": "empty"}

    from app.models.search_history import SearchHistory

    h = SearchHistory(
        site_user_id=user.id,
        query=body.query.strip() if body.query else None,
        location=body.location.strip() if body.location else None,
        project_id=body.project_id or None,
        source=body.source,
    )
    db.add(h)
    db.commit()
    return {"ok": True}


# ── My profile ────────────────────────────────────────────────────────────────

@router.get("/me")
def get_my_profile(request: Request, db: Session = Depends(get_db)):
    user = get_optional_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Autenticación requerida.")

    from app.models.user_preference import UserPreference
    from app.models.user_property_interaction import UserPropertyInteraction
    from app.models.search_history import SearchHistory

    pref = db.query(UserPreference).filter_by(site_user_id=user.id).first()

    interactions = (
        db.query(UserPropertyInteraction)
        .filter_by(site_user_id=user.id)
        .order_by(UserPropertyInteraction.created_at.desc())
        .limit(50)
        .all()
    )

    history = (
        db.query(SearchHistory)
        .filter_by(site_user_id=user.id)
        .order_by(SearchHistory.created_at.desc())
        .limit(30)
        .all()
    )

    return {
        "preferences": {
            "location": pref.location,
            "bedrooms": pref.bedrooms,
            "min_price": pref.min_price,
            "max_price": pref.max_price,
            "features": pref.features or [],
            "keywords": pref.keywords or [],
            "raw_description": pref.raw_description,
            "updated_at": pref.updated_at.isoformat() if pref and pref.updated_at else None,
        } if pref else None,
        "interactions": [
            {
                "record_id": str(i.record_id),
                "rating": i.rating,
                "interested": i.interested,
                "seen_in_chat": i.seen_in_chat,
                "rated_at": i.rated_at.isoformat() if i.rated_at else None,
            }
            for i in interactions
        ],
        "search_history": [
            {
                "id": str(h.id),
                "query": h.query,
                "location": h.location,
                "project_id": h.project_id,
                "source": h.source,
                "created_at": h.created_at.isoformat() if h.created_at else None,
            }
            for h in history
        ],
    }


# ── My ratings (quick lookup) ─────────────────────────────────────────────────

@router.get("/my-ratings")
def get_my_ratings(request: Request, db: Session = Depends(get_db)):
    """Returns a map of record_id → rating for the authenticated user."""
    user = get_optional_user(request, db)
    if not user:
        return {}

    from app.models.user_property_interaction import UserPropertyInteraction

    rows = (
        db.query(UserPropertyInteraction)
        .filter(
            UserPropertyInteraction.site_user_id == user.id,
            UserPropertyInteraction.rating.isnot(None),
        )
        .all()
    )
    return {str(r.record_id): r.rating for r in rows}
