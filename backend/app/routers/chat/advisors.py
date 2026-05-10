"""Sales advisors CRUD."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional
from pydantic import BaseModel

from database import get_db
from app.models.sales_advisor import SalesAdvisor

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


@router.get("/advisors")
async def list_advisors(db: Session = Depends(get_db)):
    return [_serialize(a) for a in db.query(SalesAdvisor).order_by(SalesAdvisor.created_at.desc()).all()]


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
