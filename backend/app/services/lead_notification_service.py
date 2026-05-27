"""Lead assignment and advisor email notifications."""

import html
import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.sales_advisor import SalesAdvisor

from app.models.site_user import SiteUser
from app.models.user_preference import UserPreference
from app.models.web_chat_session import WebChatSession
from app.services.email_service import send_email
from app.services.matchmaking import get_record_data
from app.services.preference_service import criteria_from_preference, summarize_preference

logger = logging.getLogger(__name__)

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


def _first_scalar_by_keys(obj: Any, keys: set[str]) -> str | None:
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


def _pick_active_advisor(db: Session) -> SalesAdvisor | None:
    advisor = (
        db.query(SalesAdvisor)
        .filter(
            SalesAdvisor.is_active.is_(True),
            SalesAdvisor.email.isnot(None),
            SalesAdvisor.email != "",
        )
        .order_by(SalesAdvisor.updated_at.desc().nullslast(), SalesAdvisor.created_at.desc())
        .first()
    )
    if advisor:
        return advisor
    return (
        db.query(SalesAdvisor)
        .filter(SalesAdvisor.is_active.is_(True))
        .order_by(SalesAdvisor.updated_at.desc().nullslast(), SalesAdvisor.created_at.desc())
        .first()
    )


def _clean_profile_criteria(criteria: dict | None) -> dict:
    return {k: v for k, v in (criteria or {}).items() if not str(k).startswith("_")}


def _format_optional(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, list):
        clean = [str(v).strip() for v in value if str(v).strip()]
        return ", ".join(clean) if clean else "-"
    text = str(value).strip()
    return text if text else "-"


def _summarize_property(property_data: dict | None, record_id: str | None) -> dict:
    data = property_data if isinstance(property_data, dict) else {}
    title = _first_scalar_by_keys(
        data,
        {"titulo", "title", "nombre", "name", "proyecto", "project", "project_name"},
    )
    model = _first_scalar_by_keys(data, {"modelo", "model", "tipo", "tipologia", "tipologia_modelo"})
    location = _first_scalar_by_keys(
        data,
        {"ubicacion", "direccion", "distrito", "zona", "location", "address"},
    )
    price = _first_scalar_by_keys(data, {"precio", "price", "precio_desde", "from_price", "monto"})
    return {
        "record_id": record_id,
        "title": title,
        "model": model,
        "location": location,
        "price": price,
        "raw_data": data,
    }


def _build_profile_payload(session: WebChatSession, db: Session) -> dict:
    criteria = _clean_profile_criteria(session.extracted_criteria if isinstance(session.extracted_criteria, dict) else {})
    payload: dict[str, Any] = {
        "session_id": str(session.id),
        "ideal_description": session.ideal_description,
        "criteria": criteria,
    }
    if not session.site_user_id:
        return payload

    user_pref = db.query(UserPreference).filter(UserPreference.site_user_id == session.site_user_id).first()
    if user_pref:
        payload["saved_preferences"] = criteria_from_preference(user_pref)
        payload["saved_summary"] = summarize_preference(user_pref)
    return payload


def _build_lead_email_html(
    advisor_name: str,
    lead: dict,
    site_user: SiteUser | None,
    profile_payload: dict,
    property_payload: dict,
) -> str:
    lead_full_name = _format_optional(lead.get("full_name") or (site_user.name if site_user else None))
    lead_country = _format_optional(lead.get("country_of_residence"))
    lead_whatsapp = _format_optional(lead.get("whatsapp") or (site_user.phone if site_user else None))
    lead_document = _format_optional(lead.get("document_number"))
    lead_financial_doc = _format_optional(lead.get("financial_capacity_doc"))
    lead_email = _format_optional(site_user.email if site_user else None)
    lead_rating = _format_optional(lead.get("rating"))

    criteria = profile_payload.get("criteria") or {}
    criteria_text = json.dumps(criteria, ensure_ascii=False, indent=2)
    profile_text = json.dumps(profile_payload, ensure_ascii=False, indent=2)
    property_text = json.dumps(property_payload.get("raw_data") or {}, ensure_ascii=False, indent=2)

    return f"""
    <div style="font-family:sans-serif;max-width:760px;margin:auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px 0">Nuevo lead interesado en una propiedad</h2>
      <p style="margin:0 0 18px 0;color:#475569">Hola {html.escape(advisor_name)}, se registro un nuevo interes desde el chat web.</p>

      <h3 style="margin:16px 0 8px 0">Datos del cliente</h3>
      <p><strong>Nombre completo:</strong> {html.escape(lead_full_name)}</p>
      <p><strong>Email:</strong> {html.escape(lead_email)}</p>
      <p><strong>WhatsApp:</strong> {html.escape(lead_whatsapp)}</p>
      <p><strong>Documento:</strong> {html.escape(lead_document)}</p>
      <p><strong>Sustento financiero:</strong> {html.escape(lead_financial_doc)}</p>
      <p><strong>Pais de residencia:</strong> {html.escape(lead_country)}</p>
      <p><strong>Calificacion:</strong> {html.escape(lead_rating)}</p>
      <p><strong>Session ID:</strong> <code>{html.escape(str(profile_payload.get("session_id") or "-"))}</code></p>

      <h3 style="margin:16px 0 8px 0">Datos de la propiedad</h3>
      <p><strong>ID registro:</strong> {html.escape(_format_optional(property_payload.get("record_id")))}</p>
      <p><strong>Titulo:</strong> {html.escape(_format_optional(property_payload.get("title")))}</p>
      <p><strong>Modelo:</strong> {html.escape(_format_optional(property_payload.get("model")))}</p>
      <p><strong>Ubicacion:</strong> {html.escape(_format_optional(property_payload.get("location")))}</p>
      <p><strong>Precio:</strong> {html.escape(_format_optional(property_payload.get("price")))}</p>

      <h3 style="margin:16px 0 8px 0">Perfilamiento (criterios de busqueda)</h3>
      <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin:0 0 12px 0">{html.escape(criteria_text)}</pre>

      <h3 style="margin:16px 0 8px 0">Perfilamiento completo</h3>
      <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin:0 0 12px 0">{html.escape(profile_text)}</pre>

      <h3 style="margin:16px 0 8px 0">Datos completos de la propiedad</h3>
      <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px">{html.escape(property_text)}</pre>
    </div>
    """


def notify_active_advisor_for_lead(
    session: WebChatSession,
    db: Session,
    lead: dict | None,
) -> tuple[bool, dict]:
    """Assign active advisor and email lead + property + profiling data."""
    lead_payload = dict(lead or {})
    if lead_payload.get("advisor_notified_at"):
        return True, lead_payload

    advisor = _pick_active_advisor(db)
    if not advisor:
        lead_payload["advisor_error"] = "no_active_advisor"
        return False, lead_payload

    lead_payload["advisor_id"] = str(advisor.id)
    lead_payload["advisor_name"] = advisor.name
    lead_payload["advisor_email"] = advisor.email
    lead_payload["advisor_assigned_at"] = datetime.now(timezone.utc).isoformat()

    if not advisor.email:
        lead_payload["advisor_error"] = "active_advisor_without_email"
        return False, lead_payload

    record_id = lead_payload.get("record_id")
    property_data: dict | None = None
    if record_id:
        try:
            rid = UUID(str(record_id))
            property_data = get_record_data(db, str(rid))
        except Exception as exc:
            logger.warning("[lead-email] could not load record %s: %s", record_id, exc)

    property_payload = _summarize_property(property_data, str(record_id) if record_id else None)
    profile_payload = _build_profile_payload(session, db)
    site_user = None
    if session.site_user_id:
        site_user = db.query(SiteUser).filter(SiteUser.id == session.site_user_id).first()

    subject_id = _format_optional(property_payload.get("title"))
    subject_user = _format_optional(lead_payload.get("full_name") or (site_user.name if site_user else None))
    subject = f"Nuevo lead interesado | {subject_id} | {subject_user}"
    html_body = _build_lead_email_html(advisor.name, lead_payload, site_user, profile_payload, property_payload)

    sent = send_email(advisor.email, subject, html_body)
    if not sent:
        lead_payload["advisor_error"] = "email_send_failed"
        return False, lead_payload

    lead_payload["advisor_notified_at"] = datetime.now(timezone.utc).isoformat()
    lead_payload.pop("advisor_error", None)
    return True, lead_payload
