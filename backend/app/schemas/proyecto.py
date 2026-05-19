from pydantic import BaseModel
from typing import Any, Optional
from uuid import UUID
from datetime import datetime


class ProyectoResponse(BaseModel):
    id: UUID
    developer_id: UUID
    url_node_id: UUID
    source_url: str
    status: str
    scraped_at: datetime
    url_propiedad: Optional[str] = None
    estado_del_proyecto: Optional[str] = None
    proyecto: Optional[str] = None
    dormitorios: Optional[str] = None
    m2: Optional[str] = None
    ubicacion: Optional[str] = None
    precio_desde: Optional[str] = None
    imagen: Optional[Any] = None
    extra_data: Optional[dict] = None

    class Config:
        from_attributes = True
