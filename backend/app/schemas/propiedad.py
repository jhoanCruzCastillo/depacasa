from pydantic import BaseModel
from typing import Any, Optional
from uuid import UUID
from datetime import datetime


class PropiedadResponse(BaseModel):
    id: UUID
    proyecto_id: Optional[UUID] = None
    status: str
    scraped_at: datetime
    imagen_modelo: Optional[str] = None
    dormitorios: Optional[str] = None
    m2: Optional[str] = None
    modelo: Optional[str] = None
    modelo_imagen: Optional[str] = None
    extra_data: Optional[dict] = None

    class Config:
        from_attributes = True
