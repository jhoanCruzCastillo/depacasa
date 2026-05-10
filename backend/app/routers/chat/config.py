"""Chat global configuration endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel

from database import get_db
from app.models.chat_config import ChatConfig, DEFAULT_CONFIG_ID

router = APIRouter()


class ConfigIn(BaseModel):
    top_n_properties: Optional[int] = None
    greeting_message: Optional[str] = None
    contact_message: Optional[str] = None
    no_results_message: Optional[str] = None
    no_more_message: Optional[str] = None


def _get_or_create(db: Session) -> ChatConfig:
    config = db.query(ChatConfig).filter(ChatConfig.id == DEFAULT_CONFIG_ID).first()
    if not config:
        config = ChatConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def _serialize(config: ChatConfig) -> dict:
    return {
        "top_n_properties": config.top_n_properties,
        "greeting_message": config.greeting_message,
        "contact_message": config.contact_message,
        "no_results_message": config.no_results_message,
        "no_more_message": config.no_more_message,
    }


@router.get("/config")
async def get_config(db: Session = Depends(get_db)):
    return _serialize(_get_or_create(db))


@router.put("/config")
async def update_config(body: ConfigIn, db: Session = Depends(get_db)):
    config = _get_or_create(db)
    for k, v in body.dict(exclude_none=True).items():
        setattr(config, k, v)
    db.commit()
    db.refresh(config)
    return _serialize(config)
