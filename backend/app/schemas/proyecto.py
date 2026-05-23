from pydantic import BaseModel
from typing import Any, Optional
from uuid import UUID
from datetime import datetime


class ProyectoResponse(BaseModel):
    id: UUID
    developer_id: UUID
    status: str
    scraped_at: datetime
    nombre: Optional[str] = None
    estado_del_proyecto: Optional[str] = None
    ubicacion: Optional[str] = None
    precio_desde: Optional[str] = None
    imagen: Optional[Any] = None
    descripcion: Optional[str] = None
    areas_comunes_exterior_e_interior_img: Optional[Any] = None
    areas_comunes: Optional[Any] = None
    areas_comunes_imagenes: Optional[Any] = None
    lugares_cercanos: Optional[Any] = None
    extra_data: Optional[dict] = None

    class Config:
        from_attributes = True
