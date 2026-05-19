from pydantic import BaseModel
from typing import Any, Optional
from uuid import UUID
from datetime import datetime


class PropiedadResponse(BaseModel):
    id: UUID
    developer_id: UUID
    proyecto_id: Optional[UUID] = None
    url_node_id: UUID
    source_url: str
    status: str
    scraped_at: datetime
    url_propiedad: Optional[str] = None
    estado_del_proyecto: Optional[str] = None
    ubicacion: Optional[str] = None
    imagen_modelo: Optional[str] = None
    lugares_cercanos: Optional[Any] = None
    proyecto: Optional[str] = None
    dormitorios: Optional[str] = None
    m2: Optional[str] = None
    areas_comunes_e_interior: Optional[Any] = None
    modelo: Optional[str] = None
    descripcion: Optional[str] = None
    precio_desde: Optional[str] = None
    areas_comunes: Optional[Any] = None
    areas_comunes_imagenes: Optional[Any] = None
    imagen: Optional[Any] = None
    extra_data: Optional[dict] = None

    class Config:
        from_attributes = True
