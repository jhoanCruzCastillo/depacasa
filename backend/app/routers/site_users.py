"""Admin CRUD for registered site users + scoring + document validation."""

from pathlib import PurePosixPath
from urllib.parse import urlparse
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Literal
from uuid import UUID

from database import get_db
from app.models.site_user import SiteUser
from app.services.email_service import send_email
from app.models.user_preference import UserPreference
from app.models.user_property_interaction import UserPropertyInteraction
from app.models.search_history import SearchHistory
from app.models.scraped_record import ScrapedRecord
from app.models.web_chat_session import WebChatSession
from app.services.preference_service import build_preferences_v2_from_criteria, default_preferences_v2
from app.services.lead_scoring_service import compute_score, compute_score_for_user_id

router = APIRouter(prefix="/api/site-users", tags=["site-users"])


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    country: Optional[str] = None
    phone: Optional[str] = None
    wants_newsletter: Optional[bool] = None


class TestEmailIn(BaseModel):
    subject: str = "Correo de prueba"
    body: str = "Este es un correo de prueba enviado desde el panel de administración."


class ValidateDocumentIn(BaseModel):
    status: Literal["pending", "approved", "rejected"]
    notes: Optional[str] = None
    reviewed_by: Optional[str] = None


def _clean_text(value: object) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _guess_doc_kind(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    path = urlparse(value).path or value
    ext = PurePosixPath(path).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".heic"}:
        return "image"
    if ext:
        return "file"
    if value.lower().startswith("data:image/"):
        return "image"
    return "link"


def _document_flags_from_lead(lead: dict | None) -> tuple[bool, bool]:
    payload = lead if isinstance(lead, dict) else {}
    identity_doc = _clean_text(payload.get("document_number")) or _clean_text(payload.get("document"))
    financial_doc = _clean_text(payload.get("financial_capacity_doc"))
    return bool(identity_doc or financial_doc), bool(financial_doc)


def _document_flags_from_context(context: dict | None) -> tuple[bool, bool]:
    payload = context if isinstance(context, dict) else {}
    lead_profile = payload.get("lead_profile")
    if not isinstance(lead_profile, dict):
        return False, False
    return _document_flags_from_lead(lead_profile)


def _out(u: SiteUser, doc_flags: Optional[dict] = None, score_summary: Optional[dict] = None) -> dict:
    data = {
        "id": str(u.id),
        "email": u.email,
        "name": u.name,
        "country": u.country,
        "phone": u.phone,
        "wants_newsletter": u.wants_newsletter,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "financial_doc_status": u.financial_doc_status,
        "financial_doc_notes": u.financial_doc_notes,
        "financial_doc_reviewed_at": (
            u.financial_doc_reviewed_at.isoformat() if u.financial_doc_reviewed_at else None
        ),
        "financial_doc_reviewed_by": u.financial_doc_reviewed_by,
    }
    if doc_flags:
        data.update(doc_flags)
    if score_summary:
        data["score"] = score_summary
    return data


def _norm_key(key: str) -> str:
    return (
        (key or "")
        .strip()
        .lower()
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace("ñ", "n")
    )


def _first_scalar_by_keys(obj, keys: set[str]) -> Optional[str]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if _norm_key(str(k)) in keys and isinstance(v, (str, int, float)):
                value = str(v).strip()
                if value:
                    return value
        for v in obj.values():
            found = _first_scalar_by_keys(v, keys)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _first_scalar_by_keys(item, keys)
            if found:
                return found
    return None


def _summarize_record(record: Optional[ScrapedRecord]) -> dict:
    if not record:
        return {
            "source_url": None,
            "property_title": None,
            "property_model": None,
            "property_location": None,
            "property_price": None,
        }

    data = record.data if isinstance(record.data, dict) else {}
    title = _first_scalar_by_keys(
        data,
        {"titulo", "title", "nombre", "name", "proyecto", "project", "project_name"},
    )
    model = _first_scalar_by_keys(data, {"modelo", "model", "tipo", "tipologia", "tipologia_modelo"})
    location = _first_scalar_by_keys(
        data,
        {"ubicacion", "direccion", "distrito", "zona", "location", "address"},
    )
    price = _first_scalar_by_keys(
        data,
        {"precio", "price", "precio_desde", "from_price", "monto"},
    )

    return {
        "source_url": record.source_url,
        "property_title": title,
        "property_model": model,
        "property_location": location,
        "property_price": price,
    }


def _load_doc_flags(user_ids: list, db: Session) -> dict:
    flags: dict = {
        uid: {"has_uploaded_documents": False, "has_financial_document": False}
        for uid in user_ids
    }
    if not user_ids:
        return flags

    prefs = (
        db.query(UserPreference.site_user_id, UserPreference.context)
        .filter(UserPreference.site_user_id.in_(user_ids))
        .all()
    )
    for site_user_id, context in prefs:
        has_any, has_financial = _document_flags_from_context(context)
        if has_any:
            flags[site_user_id]["has_uploaded_documents"] = True
        if has_financial:
            flags[site_user_id]["has_financial_document"] = True

    unresolved_ids = [
        uid for uid in user_ids
        if not flags[uid]["has_uploaded_documents"] or not flags[uid]["has_financial_document"]
    ]
    if unresolved_ids:
        sessions = (
            db.query(WebChatSession.site_user_id, WebChatSession.extracted_criteria)
            .filter(WebChatSession.site_user_id.in_(unresolved_ids))
            .order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
            .all()
        )
        for site_user_id, extracted_criteria in sessions:
            if site_user_id not in flags:
                continue
            criteria = extracted_criteria if isinstance(extracted_criteria, dict) else {}
            lead = criteria.get("_lead") if isinstance(criteria.get("_lead"), dict) else {}
            has_any, has_financial = _document_flags_from_lead(lead)
            if has_any:
                flags[site_user_id]["has_uploaded_documents"] = True
            if has_financial:
                flags[site_user_id]["has_financial_document"] = True

    return flags


def _load_scores_batch(user_ids: list, users: list[SiteUser], db: Session) -> dict:
    """Load scoring data for a batch of users and return {user_id: score_summary}."""
    if not user_ids:
        return {}

    prefs_map = {
        p.site_user_id: p
        for p in db.query(UserPreference).filter(UserPreference.site_user_id.in_(user_ids)).all()
    }
    interactions_map: dict = {uid: [] for uid in user_ids}
    for i in db.query(UserPropertyInteraction).filter(UserPropertyInteraction.site_user_id.in_(user_ids)).all():
        interactions_map[i.site_user_id].append(i)

    sessions_map: dict = {uid: [] for uid in user_ids}
    for s in (
        db.query(WebChatSession)
        .filter(WebChatSession.site_user_id.in_(user_ids))
        .order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
        .all()
    ):
        sessions_map[s.site_user_id].append(s)

    result = {}
    user_map = {u.id: u for u in users}
    for uid in user_ids:
        user = user_map.get(uid)
        if not user:
            continue
        full = compute_score(
            user,
            prefs_map.get(uid),
            interactions_map[uid],
            sessions_map[uid],
        )
        result[uid] = {
            "total": full["total"],
            "max": full["max"],
            "tier": full["tier"],
        }
    return result


# ── List / CRUD endpoints ──────────────────────────────────────────────────────

@router.get("")
def list_users(
    skip: int = 0,
    limit: int = 20,
    search: str = "",
    tier: str = "",
    doc_status: str = "",
    sort_by: str = "created_at",
    db: Session = Depends(get_db),
):
    q = db.query(SiteUser)
    if search:
        term = f"%{search}%"
        q = q.filter(
            SiteUser.email.ilike(term) |
            SiteUser.name.ilike(term) |
            SiteUser.country.ilike(term)
        )
    if doc_status:
        if doc_status == "none":
            q = q.filter(SiteUser.financial_doc_status.is_(None))
        else:
            q = q.filter(SiteUser.financial_doc_status == doc_status)

    total_raw = q.with_entities(func.count()).scalar()
    users = q.order_by(SiteUser.created_at.desc()).offset(skip).limit(limit).all()
    user_ids = [u.id for u in users]

    doc_flags_by_user = _load_doc_flags(user_ids, db)
    scores_by_user = _load_scores_batch(user_ids, users, db)

    items = []
    for u in users:
        score_summary = scores_by_user.get(u.id)
        # Filter by tier client-side if needed (score computed in memory)
        if tier and score_summary and score_summary["tier"]["key"] != tier:
            continue
        items.append(_out(u, doc_flags=doc_flags_by_user.get(u.id), score_summary=score_summary))

    # When tier filter is active total count is approximate (filtered after fetch)
    total = len(items) if tier else total_raw

    return {"total": total, "items": items}


@router.get("/ranked")
def list_users_ranked(
    skip: int = 0,
    limit: int = 50,
    tier: str = "",
    doc_status: str = "",
    search: str = "",
    db: Session = Depends(get_db),
):
    """Return users sorted by score descending — used by the scoring dashboard."""
    q = db.query(SiteUser)
    if search:
        term = f"%{search}%"
        q = q.filter(
            SiteUser.email.ilike(term) |
            SiteUser.name.ilike(term) |
            SiteUser.country.ilike(term)
        )
    if doc_status:
        if doc_status == "none":
            q = q.filter(SiteUser.financial_doc_status.is_(None))
        else:
            q = q.filter(SiteUser.financial_doc_status == doc_status)

    # Load all matching users (for in-memory score sort) up to a sensible cap
    all_users = q.order_by(SiteUser.created_at.desc()).limit(500).all()
    user_ids = [u.id for u in all_users]

    doc_flags_by_user = _load_doc_flags(user_ids, db)
    scores_by_user = _load_scores_batch(user_ids, all_users, db)

    rows = []
    for u in all_users:
        score_summary = scores_by_user.get(u.id, {"total": 0, "max": 100, "tier": {"key": "frio", "label": "Frío"}})
        if tier and score_summary["tier"]["key"] != tier:
            continue
        rows.append(_out(u, doc_flags=doc_flags_by_user.get(u.id), score_summary=score_summary))

    rows.sort(key=lambda r: r.get("score", {}).get("total", 0), reverse=True)
    total = len(rows)
    return {"total": total, "items": rows[skip: skip + limit]}


@router.get("/{user_id}")
def get_user(user_id: UUID, db: Session = Depends(get_db)):
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return _out(u)


@router.put("/{user_id}")
def update_user(user_id: UUID, body: UserUpdate, db: Session = Depends(get_db)):
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    if body.email is not None:
        existing = db.query(SiteUser).filter(SiteUser.email == body.email.lower(), SiteUser.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Ese correo ya está en uso.")
        u.email = body.email.lower()
    for field in ("name", "country", "phone", "wants_newsletter"):
        val = getattr(body, field)
        if val is not None:
            setattr(u, field, val)
    db.commit()
    db.refresh(u)
    return _out(u)


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: UUID, db: Session = Depends(get_db)):
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    db.delete(u)
    db.commit()


# ── Score endpoints ────────────────────────────────────────────────────────────

@router.get("/{user_id}/score")
def get_user_score(user_id: UUID, db: Session = Depends(get_db)):
    """Detailed scoring breakdown for a user."""
    score = compute_score_for_user_id(user_id, db)
    if score is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return score


@router.post("/{user_id}/validate-document")
def validate_document(user_id: UUID, body: ValidateDocumentIn, db: Session = Depends(get_db)):
    """Admin manually approves or rejects a user's financial document."""
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    u.financial_doc_status = body.status
    u.financial_doc_notes = body.notes
    u.financial_doc_reviewed_by = body.reviewed_by
    u.financial_doc_reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(u)
    return {
        "financial_doc_status": u.financial_doc_status,
        "financial_doc_notes": u.financial_doc_notes,
        "financial_doc_reviewed_at": (
            u.financial_doc_reviewed_at.isoformat() if u.financial_doc_reviewed_at else None
        ),
        "financial_doc_reviewed_by": u.financial_doc_reviewed_by,
    }


# ── Profile endpoint ───────────────────────────────────────────────────────────

@router.get("/{user_id}/profile")
def get_user_profile(user_id: UUID, db: Session = Depends(get_db)):
    """Admin view: full preference + interaction + history profile for a user."""
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    pref = db.query(UserPreference).filter_by(site_user_id=user_id).first()

    interactions = (
        db.query(UserPropertyInteraction)
        .filter_by(site_user_id=user_id)
        .order_by(UserPropertyInteraction.created_at.desc())
        .limit(20)
        .all()
    )
    record_ids = [i.record_id for i in interactions if i.record_id]
    record_map = {}
    if record_ids:
        rows = db.query(ScrapedRecord).filter(ScrapedRecord.id.in_(record_ids)).all()
        record_map = {r.id: r for r in rows}

    history = (
        db.query(SearchHistory)
        .filter_by(site_user_id=user_id)
        .order_by(SearchHistory.created_at.desc())
        .limit(20)
        .all()
    )

    lead_data: dict = {}
    lead_updated_at = None
    sessions = (
        db.query(WebChatSession)
        .filter(WebChatSession.site_user_id == user_id)
        .order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
        .limit(25)
        .all()
    )
    for s in sessions:
        criteria = s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {}
        candidate = criteria.get("_lead")
        if isinstance(candidate, dict) and candidate:
            lead_data = candidate
            lead_updated_at = s.updated_at or s.created_at
            break

    lead_profile_context = {}
    if pref and isinstance(pref.context, dict):
        context_lead = pref.context.get("lead_profile")
        if isinstance(context_lead, dict):
            lead_profile_context = context_lead

    lead_document = (
        _clean_text(lead_data.get("document_number"))
        or _clean_text(lead_profile_context.get("document"))
    )
    financial_doc = (
        _clean_text(lead_data.get("financial_capacity_doc"))
        or _clean_text(lead_profile_context.get("financial_capacity_doc"))
    )
    has_docs = bool(lead_document or financial_doc)
    has_financial = bool(financial_doc)

    score = compute_score(u, pref, interactions, sessions)

    return {
        "user": _out(u),
        "score": score,
        "lead": {
            "full_name": lead_data.get("full_name"),
            "whatsapp": lead_data.get("whatsapp"),
            "document_number": lead_document,
            "financial_capacity_doc": financial_doc,
            "country_of_residence": lead_data.get("country_of_residence"),
            "record_id": str(lead_data.get("record_id")) if lead_data.get("record_id") else None,
            "rating": lead_data.get("rating"),
            "updated_at": lead_updated_at.isoformat() if lead_updated_at else None,
        },
        "documents": {
            "has_uploaded_documents": has_docs,
            "has_financial_document": has_financial,
            "identity_document": lead_document,
            "financial_capacity_doc_url": financial_doc,
            "financial_capacity_doc_kind": _guess_doc_kind(financial_doc),
        },
        "preferences": (
            pref.preferences_v2
            if pref and isinstance(pref.preferences_v2, dict) and pref.preferences_v2
            else (
                build_preferences_v2_from_criteria(
                    {
                        "location": pref.location if pref else None,
                        "bedrooms": pref.bedrooms if pref else None,
                        "features": pref.features if pref else [],
                        "keywords": pref.keywords if pref else [],
                        "min_price": pref.min_price if pref else None,
                        "max_price": pref.max_price if pref else None,
                    },
                    None,
                )
                if pref
                else default_preferences_v2()
            )
        ),
        "context": (pref.context if pref and isinstance(pref.context, dict) else {}),
        "preferences_updated_at": pref.updated_at.isoformat() if pref and pref.updated_at else None,
        "interactions": [
            {
                "record_id": str(i.record_id),
                "rating": i.rating,
                "interested": i.interested,
                "seen_in_chat": i.seen_in_chat,
                "rated_at": i.rated_at.isoformat() if i.rated_at else None,
                "seen_at": i.seen_at.isoformat() if i.seen_at else None,
                "created_at": i.created_at.isoformat() if i.created_at else None,
                **_summarize_record(record_map.get(i.record_id)),
            }
            for i in interactions
        ],
        "search_history": [
            {
                "id": str(h.id),
                "query": h.query,
                "location": h.location,
                "source": h.source,
                "created_at": h.created_at.isoformat() if h.created_at else None,
            }
            for h in history
        ],
    }


# ── Email endpoint ─────────────────────────────────────────────────────────────

@router.post("/{user_id}/send-email")
def send_test_email(user_id: UUID, body: TestEmailIn, db: Session = Depends(get_db)):
    u = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px 24px">
      <p style="color:#1e3a5f;font-size:15px;line-height:1.6">{body.body}</p>
    </div>
    """
    ok = send_email(u.email, body.subject, html)
    if not ok:
        raise HTTPException(status_code=503, detail="No se pudo enviar el correo. Verifica la configuración de Resend.")
    return {"sent": True, "to": u.email}
