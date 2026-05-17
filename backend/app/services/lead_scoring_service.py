"""Lead scoring: computes a 0-100 qualification score for each site user."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.site_user import SiteUser
from app.models.user_preference import UserPreference
from app.models.user_property_interaction import UserPropertyInteraction
from app.models.web_chat_session import WebChatSession


# ── Tier boundaries ────────────────────────────────────────────────────────────

_TIERS = [
    (76, "muy_caliente", "Muy caliente"),
    (56, "caliente", "Caliente"),
    (31, "tibio", "Tibio"),
    (0,  "frio",   "Frío"),
]


def _tier(total: int) -> dict:
    for threshold, key, label in _TIERS:
        if total >= threshold:
            return {"key": key, "label": label}
    return {"key": "frio", "label": "Frío"}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _days_since(dt: Optional[datetime]) -> Optional[int]:
    aware = _utc(dt)
    if aware is None:
        return None
    return (datetime.now(timezone.utc) - aware).days


def _extract_lead_from_sessions(sessions: list[WebChatSession]) -> dict:
    for s in sessions:
        criteria = s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {}
        candidate = criteria.get("_lead")
        if isinstance(candidate, dict) and candidate:
            return candidate
    return {}


def _extract_lead_from_context(pref: Optional[UserPreference]) -> dict:
    if pref and isinstance(pref.context, dict):
        lp = pref.context.get("lead_profile")
        if isinstance(lp, dict):
            return lp
    return {}


# ── Scoring components (each returns pts and detail) ──────────────────────────

def _score_perfil(user: SiteUser, lead: dict, lead_ctx: dict) -> dict:
    """Datos de perfil completos — max 15 pts."""
    pts = 0
    detail: list[str] = []

    has_name = bool(user.name or lead.get("full_name") or lead_ctx.get("full_name"))
    if has_name:
        pts += 3
        detail.append("Nombre registrado (+3)")

    has_phone = bool(user.phone or lead.get("whatsapp") or lead_ctx.get("whatsapp"))
    if has_phone:
        pts += 3
        detail.append("Teléfono/WhatsApp registrado (+3)")

    has_country = bool(
        user.country
        or lead.get("country_of_residence")
        or lead_ctx.get("country_of_residence")
    )
    if has_country:
        pts += 2
        detail.append("País de residencia registrado (+2)")

    has_dni = bool(
        lead.get("document_number") or lead_ctx.get("document") or lead_ctx.get("document_number")
    )
    if has_dni:
        pts += 4
        detail.append("Documento de identidad capturado (+4)")

    has_rating = lead.get("rating") is not None or lead_ctx.get("rating") is not None
    if has_rating:
        pts += 3
        detail.append("Calificación de asesor registrada (+3)")

    return {"pts": min(pts, 15), "max": 15, "detail": detail}


def _score_presupuesto(pref: Optional[UserPreference]) -> dict:
    """Presupuesto definido — max 10 pts."""
    pts = 0
    detail: list[str] = []

    min_price = pref.min_price if pref else None
    max_price = pref.max_price if pref else None

    # Also check preferences_v2 for budget
    if pref and isinstance(pref.preferences_v2, dict):
        v2 = pref.preferences_v2
        presupuesto = v2.get("presupuesto") or {}
        if isinstance(presupuesto, dict) and presupuesto.get("valor") is not None:
            valor = presupuesto["valor"]
            if isinstance(valor, dict):
                if valor.get("min") is not None:
                    min_price = min_price or valor["min"]
                if valor.get("max") is not None:
                    max_price = max_price or valor["max"]
            elif isinstance(valor, (int, float)):
                max_price = max_price or valor

    if min_price is not None:
        pts += 5
        detail.append("Precio mínimo definido (+5)")
    if max_price is not None:
        pts += 5
        detail.append("Precio máximo definido (+5)")

    return {"pts": min(pts, 10), "max": 10, "detail": detail}


def _score_preferencias(pref: Optional[UserPreference]) -> dict:
    """Preferencias de búsqueda definidas — max 10 pts."""
    pts = 0
    detail: list[str] = []

    if pref and pref.location:
        pts += 5
        detail.append("Ubicación definida (+5)")

    if pref and isinstance(pref.preferences_v2, dict):
        v2 = pref.preferences_v2
        skip_keys = {"presupuesto"}
        defined = [
            k for k, v in v2.items()
            if k not in skip_keys
            and isinstance(v, dict)
            and v.get("valor") is not None
        ]
        bonus = min(len(defined), 5)
        if bonus > 0:
            pts += bonus
            detail.append(f"{len(defined)} preferencias adicionales definidas (+{bonus})")

    return {"pts": min(pts, 10), "max": 10, "detail": detail}


def _score_actividad(
    interactions: list[UserPropertyInteraction],
    sessions: list[WebChatSession],
) -> dict:
    """Actividad y recencia — max 20 pts."""
    pts = 0
    detail: list[str] = []

    seen_count = sum(1 for i in interactions if i.seen_in_chat)
    seen_pts = min(seen_count, 5)
    if seen_pts:
        pts += seen_pts
        detail.append(f"{seen_count} propiedades vistas (+{seen_pts})")

    rated_count = sum(1 for i in interactions if i.rating is not None)
    rated_pts = min(rated_count * 2, 6)
    if rated_pts:
        pts += rated_pts
        detail.append(f"{rated_count} propiedades calificadas (+{rated_pts})")

    last_activity: Optional[datetime] = None
    for s in sessions:
        d = _utc(s.updated_at or s.created_at)
        if d and (last_activity is None or d > last_activity):
            last_activity = d

    days_ago = _days_since(last_activity)
    if days_ago is not None:
        if days_ago <= 7:
            pts += 9
            detail.append("Activo en los últimos 7 días (+9)")
        elif days_ago <= 30:
            pts += 6
            detail.append("Activo en los últimos 30 días (+6)")
        elif days_ago <= 90:
            pts += 3
            detail.append("Activo en los últimos 90 días (+3)")

    return {"pts": min(pts, 20), "max": 20, "detail": detail, "last_activity_days_ago": days_ago}


def _score_interes(interactions: list[UserPropertyInteraction]) -> dict:
    """Interés marcado 'Lo quiero' — max 15 pts."""
    interested_count = sum(1 for i in interactions if i.interested)
    if not interested_count:
        return {"pts": 0, "max": 15, "detail": [], "interested_count": 0}

    pts = min(5 + (interested_count - 1) * 5, 15)
    detail = [f"{interested_count} propiedades marcadas como interesadas (+{pts})"]
    return {"pts": pts, "max": 15, "detail": detail, "interested_count": interested_count}


def _score_documento_subido(lead: dict, lead_ctx: dict) -> dict:
    """Tiene documento financiero subido — max 10 pts."""
    has_doc = bool(
        lead.get("financial_capacity_doc") or lead_ctx.get("financial_capacity_doc")
    )
    if has_doc:
        return {"pts": 10, "max": 10, "detail": ["Documento financiero subido (+10)"]}
    return {"pts": 0, "max": 10, "detail": []}


def _score_documento_validado(user: SiteUser) -> dict:
    """Documento financiero validado manualmente — max 20 pts."""
    status = user.financial_doc_status
    if status == "approved":
        return {
            "pts": 20,
            "max": 20,
            "detail": ["Documento financiero aprobado por asesor (+20)"],
        }
    if status == "rejected":
        return {
            "pts": 0,
            "max": 20,
            "detail": ["Documento financiero rechazado (0 pts)"],
        }
    return {"pts": 0, "max": 20, "detail": []}


# ── Public API ─────────────────────────────────────────────────────────────────

def compute_score(
    user: SiteUser,
    pref: Optional[UserPreference],
    interactions: list[UserPropertyInteraction],
    sessions: list[WebChatSession],
) -> dict:
    """Compute a full scoring breakdown for a user. Returns score dict."""
    lead = _extract_lead_from_sessions(sessions)
    lead_ctx = _extract_lead_from_context(pref)

    s_perfil = _score_perfil(user, lead, lead_ctx)
    s_presupuesto = _score_presupuesto(pref)
    s_preferencias = _score_preferencias(pref)
    s_actividad = _score_actividad(interactions, sessions)
    s_interes = _score_interes(interactions)
    s_doc_subido = _score_documento_subido(lead, lead_ctx)
    s_doc_validado = _score_documento_validado(user)

    total = (
        s_perfil["pts"]
        + s_presupuesto["pts"]
        + s_preferencias["pts"]
        + s_actividad["pts"]
        + s_interes["pts"]
        + s_doc_subido["pts"]
        + s_doc_validado["pts"]
    )

    return {
        "total": total,
        "max": 100,
        "tier": _tier(total),
        "breakdown": {
            "perfil": s_perfil,
            "presupuesto": s_presupuesto,
            "preferencias": s_preferencias,
            "actividad": s_actividad,
            "interes": s_interes,
            "documento_subido": s_doc_subido,
            "documento_validado": s_doc_validado,
        },
        "financial_doc_status": user.financial_doc_status,
        "financial_doc_notes": user.financial_doc_notes,
        "financial_doc_reviewed_at": (
            user.financial_doc_reviewed_at.isoformat()
            if user.financial_doc_reviewed_at
            else None
        ),
        "financial_doc_reviewed_by": user.financial_doc_reviewed_by,
    }


def compute_score_for_user_id(user_id, db: Session) -> dict | None:
    """Load all data from DB and compute score. Returns None if user not found."""
    user = db.query(SiteUser).filter(SiteUser.id == user_id).first()
    if not user:
        return None

    pref = db.query(UserPreference).filter_by(site_user_id=user_id).first()
    interactions = (
        db.query(UserPropertyInteraction)
        .filter_by(site_user_id=user_id)
        .all()
    )
    sessions = (
        db.query(WebChatSession)
        .filter(WebChatSession.site_user_id == user_id)
        .order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
        .limit(50)
        .all()
    )
    return compute_score(user, pref, interactions, sessions)
