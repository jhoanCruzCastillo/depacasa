"""Sales advisors CRUD."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel

from database import get_db
from app.models.sales_advisor import SalesAdvisor
from app.models.web_chat_session import WebChatSession
from app.models.site_user import SiteUser
from app.models.scraped_record import ScrapedRecord

router = APIRouter()


class AdvisorIn(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    whatsapp_number: Optional[str] = None
    is_active: bool = True


def _serialize(a: SalesAdvisor) -> dict:
    return {
        "id": str(a.id),
        "name": a.name,
        "phone": a.phone,
        "email": a.email,
        "whatsapp_number": a.whatsapp_number,
        "is_active": a.is_active,
        "created_at": a.created_at.isoformat(),
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


def _summarize_record(record: ScrapedRecord | None) -> dict:
    if not record:
        return {
            "record_id": None,
            "source_url": None,
            "title": None,
            "location": None,
            "price": None,
        }

    data = record.data if isinstance(record.data, dict) else {}
    values = [str(v).strip() for v in data.values() if isinstance(v, (str, int, float))]
    return {
        "record_id": str(record.id),
        "source_url": record.source_url,
        "title": next((v for v in values if len(v) >= 6), None),
        "location": next((v for v in values if any(k in v.lower() for k in ["lima", "miraflores", "surco", "san "])) , None),
        "price": next((v for v in values if any(ch.isdigit() for ch in v) and any(sym in v.lower() for sym in ["$", "s/", "usd", "precio"])), None),
    }


def _parse_iso(dt_str: str | None) -> datetime | None:
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        return None


def _to_timestamp(dt_value: datetime | None) -> float:
    if not dt_value:
        return 0.0
    if dt_value.tzinfo is None:
        return dt_value.replace(tzinfo=timezone.utc).timestamp()
    return dt_value.timestamp()


def _extract_lead(criteria: dict | None) -> dict:
    if not isinstance(criteria, dict):
        return {}
    lead = criteria.get("_lead")
    return lead if isinstance(lead, dict) else {}


def _build_client_key(session: WebChatSession, lead: dict) -> str:
    if session.site_user_id:
        return f"user:{session.site_user_id}"
    if lead.get("whatsapp"):
        return f"whatsapp:{lead.get('whatsapp')}"
    if lead.get("document_number"):
        return f"document:{lead.get('document_number')}"
    return f"session:{session.id}"


def _get_assigned_sessions_for_advisor(advisor_id: str, db: Session) -> list[WebChatSession]:
    sessions = (
        db.query(WebChatSession)
        .order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
        .all()
    )
    out: list[WebChatSession] = []
    for s in sessions:
        lead = _extract_lead(s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {})
        if str(lead.get("advisor_id") or "") == advisor_id:
            out.append(s)
    return out


def _dedupe_latest_clients(sessions: list[WebChatSession]) -> list[WebChatSession]:
    latest_by_client: dict[str, WebChatSession] = {}
    assigned_at_by_client: dict[str, float] = {}
    for s in sessions:
        lead = _extract_lead(s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {})
        key = _build_client_key(s, lead)
        assigned_at = _parse_iso(lead.get("advisor_assigned_at")) or s.updated_at or s.created_at
        current = latest_by_client.get(key)
        assigned_ts = _to_timestamp(assigned_at)
        if not current or assigned_ts > assigned_at_by_client[key]:
            latest_by_client[key] = s
            assigned_at_by_client[key] = assigned_ts
    return sorted(
        latest_by_client.values(),
        key=lambda s: _to_timestamp(
            _parse_iso(_extract_lead(s.extracted_criteria).get("advisor_assigned_at")) or s.updated_at or s.created_at
        ),
        reverse=True,
    )


@router.get("/advisors")
async def list_advisors(db: Session = Depends(get_db)):
    advisors = db.query(SalesAdvisor).order_by(SalesAdvisor.created_at.desc()).all()
    sessions = (
        db.query(WebChatSession)
        .order_by(WebChatSession.updated_at.desc().nullslast(), WebChatSession.created_at.desc())
        .all()
    )
    count_by_advisor: dict[str, set[str]] = {}
    for s in sessions:
        lead = _extract_lead(s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {})
        advisor_id = str(lead.get("advisor_id") or "")
        if not advisor_id:
            continue
        key = _build_client_key(s, lead)
        count_by_advisor.setdefault(advisor_id, set()).add(key)

    out = []
    for a in advisors:
        row = _serialize(a)
        row["assigned_clients_count"] = len(count_by_advisor.get(str(a.id), set()))
        out.append(row)
    return out


@router.post("/advisors", status_code=status.HTTP_201_CREATED)
async def create_advisor(body: AdvisorIn, db: Session = Depends(get_db)):
    a = SalesAdvisor(**body.dict())
    db.add(a)
    db.commit()
    db.refresh(a)
    return _serialize(a)


@router.get("/advisors/{advisor_id}")
async def get_advisor(advisor_id: UUID, db: Session = Depends(get_db)):
    a = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Advisor not found")
    return _serialize(a)


@router.get("/advisors/{advisor_id}/clients")
async def get_advisor_clients(advisor_id: UUID, db: Session = Depends(get_db)):
    advisor = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not advisor:
        raise HTTPException(status_code=404, detail="Advisor not found")

    sessions = _dedupe_latest_clients(_get_assigned_sessions_for_advisor(str(advisor_id), db))
    user_ids = [s.site_user_id for s in sessions if s.site_user_id]
    users_map: dict[UUID, SiteUser] = {}
    if user_ids:
        rows = db.query(SiteUser).filter(SiteUser.id.in_(user_ids)).all()
        users_map = {u.id: u for u in rows}

    record_ids: list[UUID] = []
    for s in sessions:
        lead = _extract_lead(s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {})
        rid = lead.get("record_id")
        if not rid:
            continue
        try:
            record_ids.append(UUID(str(rid)))
        except Exception:
            continue
    record_map: dict[UUID, ScrapedRecord] = {}
    if record_ids:
        rows = db.query(ScrapedRecord).filter(ScrapedRecord.id.in_(record_ids)).all()
        record_map = {r.id: r for r in rows}

    clients = []
    for s in sessions:
        criteria = s.extracted_criteria if isinstance(s.extracted_criteria, dict) else {}
        lead = _extract_lead(criteria)
        user = users_map.get(s.site_user_id) if s.site_user_id else None

        record = None
        rid = lead.get("record_id")
        if rid:
            try:
                record = record_map.get(UUID(str(rid)))
            except Exception:
                record = None

        clients.append(
            {
                "session_id": str(s.id),
                "site_user_id": str(s.site_user_id) if s.site_user_id else None,
                "full_name": lead.get("full_name") or s.name or (user.name if user else None),
                "email": s.email or (user.email if user else None),
                "whatsapp": lead.get("whatsapp") or s.phone or (user.phone if user else None),
                "country_of_residence": lead.get("country_of_residence") or s.country or (user.country if user else None),
                "document_number": lead.get("document_number"),
                "rating": lead.get("rating"),
                "assigned_at": lead.get("advisor_assigned_at"),
                "notified_at": lead.get("advisor_notified_at"),
                "profiling": {k: v for k, v in criteria.items() if not str(k).startswith("_")},
                "property": _summarize_record(record),
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
        )

    return {
        "advisor": _serialize(advisor),
        "total_clients": len(clients),
        "clients": clients,
    }


@router.put("/advisors/{advisor_id}")
async def update_advisor(advisor_id: UUID, body: AdvisorIn, db: Session = Depends(get_db)):
    a = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Advisor not found")
    for k, v in body.dict().items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return _serialize(a)


@router.delete("/advisors/{advisor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_advisor(advisor_id: UUID, db: Session = Depends(get_db)):
    a = db.query(SalesAdvisor).filter(SalesAdvisor.id == advisor_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Advisor not found")
    db.delete(a)
    db.commit()
