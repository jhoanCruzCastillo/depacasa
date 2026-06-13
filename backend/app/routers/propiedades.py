from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional
from pydantic import BaseModel

from database import get_db
from app.models.propiedad import Propiedad
from app.models.scraped_record import RecordStatus

router = APIRouter(prefix="/api/propiedades", tags=["propiedades"])

EDITABLE_COLS = ("dormitorios", "baños", "m2", "modelo", "imagen_modelo", "modelo_imagen")

ALLOWED_STATUS_TRANSITIONS = {
    RecordStatus.SUCCESS,
    RecordStatus.PENDING_REVIEW,
    RecordStatus.PUBLIC,
    RecordStatus.PARTIAL,
}


class PropiedadUpdate(BaseModel):
    dormitorios:   Optional[str] = None
    baños:         Optional[str] = None
    m2:            Optional[str] = None
    modelo:        Optional[str] = None
    imagen_modelo: Optional[str] = None
    modelo_imagen: Optional[str] = None
    status:        Optional[str] = None


def _as_record(p: Propiedad) -> dict:
    return {
        "id":          str(p.id),
        "type":        "propiedad",
        "proyecto_id": str(p.proyecto_id) if p.proyecto_id else None,
        "status":      p.status.value if hasattr(p.status, "value") else str(p.status),
        "scraped_at":  p.scraped_at.isoformat() if p.scraped_at else None,
        "data":        p.to_data(),
    }


@router.get("/{propiedad_id}")
async def get_propiedad(propiedad_id: UUID, db: Session = Depends(get_db)):
    p = db.query(Propiedad).filter(Propiedad.id == propiedad_id).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Propiedad not found")
    return _as_record(p)


@router.patch("/{propiedad_id}")
async def update_propiedad(
    propiedad_id: UUID,
    body: PropiedadUpdate,
    db: Session = Depends(get_db),
):
    p = db.query(Propiedad).filter(Propiedad.id == propiedad_id).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Propiedad not found")

    for col in EDITABLE_COLS:
        val = getattr(body, col, None)
        if val is not None:
            setattr(p, col, val)

    if body.status is not None:
        try:
            new_status = RecordStatus(body.status)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {body.status}")
        if new_status not in ALLOWED_STATUS_TRANSITIONS:
            raise HTTPException(status_code=422, detail="Status transition not allowed")
        p.status = new_status

    db.commit()
    db.refresh(p)
    return _as_record(p)
