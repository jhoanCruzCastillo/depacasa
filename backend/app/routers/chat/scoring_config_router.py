from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from app.models.scoring_config import ScoringConfig

router = APIRouter()

DEFAULT_CONFIG = {
    "perfil_max": 15,
    "presupuesto_max": 10,
    "preferencias_max": 10,
    "actividad_max": 20,
    "interes_max": 15,
    "doc_subido_max": 10,
    "doc_validado_max": 20,
    "tier_muy_caliente_min": 76,
    "tier_caliente_min": 56,
    "tier_tibio_min": 31,
    "price_muy_caliente": 0,
    "price_caliente": 0,
    "price_tibio": 0,
    "price_frio": 0,
    "price_currency": "PEN",
}


class ScoringConfigOut(BaseModel):
    perfil_max: int
    presupuesto_max: int
    preferencias_max: int
    actividad_max: int
    interes_max: int
    doc_subido_max: int
    doc_validado_max: int
    tier_muy_caliente_min: int
    tier_caliente_min: int
    tier_tibio_min: int
    price_muy_caliente: Optional[float] = 0
    price_caliente: Optional[float] = 0
    price_tibio: Optional[float] = 0
    price_frio: Optional[float] = 0
    price_currency: str = "PEN"

    class Config:
        from_attributes = True


class ScoringConfigIn(BaseModel):
    perfil_max: int = Field(ge=0, le=100)
    presupuesto_max: int = Field(ge=0, le=100)
    preferencias_max: int = Field(ge=0, le=100)
    actividad_max: int = Field(ge=0, le=100)
    interes_max: int = Field(ge=0, le=100)
    doc_subido_max: int = Field(ge=0, le=100)
    doc_validado_max: int = Field(ge=0, le=100)
    tier_muy_caliente_min: int = Field(ge=0, le=200)
    tier_caliente_min: int = Field(ge=0, le=200)
    tier_tibio_min: int = Field(ge=0, le=200)
    price_muy_caliente: Optional[float] = Field(default=0, ge=0)
    price_caliente: Optional[float] = Field(default=0, ge=0)
    price_tibio: Optional[float] = Field(default=0, ge=0)
    price_frio: Optional[float] = Field(default=0, ge=0)
    price_currency: str = "PEN"


def _row_to_dict(cfg: ScoringConfig) -> dict:
    return {
        "perfil_max": cfg.perfil_max,
        "presupuesto_max": cfg.presupuesto_max,
        "preferencias_max": cfg.preferencias_max,
        "actividad_max": cfg.actividad_max,
        "interes_max": cfg.interes_max,
        "doc_subido_max": cfg.doc_subido_max,
        "doc_validado_max": cfg.doc_validado_max,
        "tier_muy_caliente_min": cfg.tier_muy_caliente_min,
        "tier_caliente_min": cfg.tier_caliente_min,
        "tier_tibio_min": cfg.tier_tibio_min,
        "price_muy_caliente": float(cfg.price_muy_caliente or 0),
        "price_caliente": float(cfg.price_caliente or 0),
        "price_tibio": float(cfg.price_tibio or 0),
        "price_frio": float(cfg.price_frio or 0),
        "price_currency": cfg.price_currency or "PEN",
    }


@router.get("/scoring-config", response_model=ScoringConfigOut)
def get_scoring_config(db: Session = Depends(get_db)):
    cfg = db.query(ScoringConfig).filter_by(id=1).first()
    if not cfg:
        return DEFAULT_CONFIG
    return _row_to_dict(cfg)


@router.put("/scoring-config", response_model=ScoringConfigOut)
def update_scoring_config(data: ScoringConfigIn, db: Session = Depends(get_db)):
    cfg = db.query(ScoringConfig).filter_by(id=1).first()
    if not cfg:
        cfg = ScoringConfig(id=1)
        db.add(cfg)
    for field, value in data.model_dump().items():
        setattr(cfg, field, value)
    db.commit()
    db.refresh(cfg)
    return _row_to_dict(cfg)
