from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional
from pydantic import BaseModel
from pathlib import Path
import hashlib

from database import get_db
from app.models.propiedad import Propiedad
from app.models.proyecto import Proyecto
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


# ── Proyectos PATCH ───────────────────────────────────────────────────────────

PROYECTO_EDITABLE = (
    "nombre", "estado_del_proyecto", "ubicacion", "precio_desde",
    "descripcion", "gmaps_url", "gmaps_coordinates",
)
PROYECTO_JSONB = (
    "areas_comunes", "areas_comunes_imagenes", "lugares_cercanos",
)


class ProyectoUpdate(BaseModel):
    nombre: Optional[str] = None
    estado_del_proyecto: Optional[str] = None
    ubicacion: Optional[str] = None
    precio_desde: Optional[str] = None
    descripcion: Optional[str] = None
    gmaps_url: Optional[str] = None
    gmaps_coordinates: Optional[str] = None
    areas_comunes: Optional[list] = None
    areas_comunes_imagenes: Optional[list] = None
    lugares_cercanos: Optional[list] = None


@router.patch("/proyectos/{proyecto_id}")
async def update_proyecto(
    proyecto_id: UUID,
    body: ProyectoUpdate,
    db: Session = Depends(get_db),
):
    p = db.query(Proyecto).filter(Proyecto.id == proyecto_id).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto not found")

    for col in PROYECTO_EDITABLE:
        val = getattr(body, col, None)
        if val is not None:
            setattr(p, col, val)

    for col in PROYECTO_JSONB:
        val = getattr(body, col, None)
        if val is not None:
            setattr(p, col, val)

    db.commit()
    db.refresh(p)
    return {
        "id": str(p.id),
        "type": "proyecto",
        "proyecto_id": None,
        "status": p.status.value if hasattr(p.status, "value") else str(p.status),
        "scraped_at": p.scraped_at.isoformat() if p.scraped_at else None,
        "data": p.to_data(),
    }


MEDIA_DIR = Path("/app/media/images")
VALID_EXTS = {"jpg", "jpeg", "png", "webp", "gif", "avif"}


@router.post("/proyectos/{proyecto_id}/images")
async def upload_proyecto_image(
    proyecto_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    p = db.query(Proyecto).filter(Proyecto.id == proyecto_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Proyecto not found")

    content = await file.read()
    ext = (file.filename or "img.jpg").rsplit(".", 1)[-1].lower()
    if ext not in VALID_EXTS:
        ext = "jpg"

    dev_dir = MEDIA_DIR / str(p.developer_id)
    dev_dir.mkdir(parents=True, exist_ok=True)

    name = f"{hashlib.md5(content).hexdigest()}.{ext}"
    filepath = dev_dir / name
    filepath.write_bytes(content)

    media_path = f"/media/images/{p.developer_id}/{name}"

    imgs = list(p.imagen or [])
    imgs.append(media_path)
    p.imagen = imgs
    db.commit()

    return {"path": media_path, "total": len(imgs)}


@router.delete("/proyectos/{proyecto_id}/images")
async def delete_proyecto_image(
    proyecto_id: UUID,
    image_url: str,
    field: str = "imagen",
    db: Session = Depends(get_db),
):
    p = db.query(Proyecto).filter(Proyecto.id == proyecto_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Proyecto not found")

    allowed = ("imagen", "areas_comunes_imagenes", "areas_comunes_exterior_e_interior_img")
    if field not in allowed:
        raise HTTPException(status_code=422, detail=f"Field must be one of {allowed}")

    current = list(getattr(p, field) or [])
    updated = [img for img in current if img != image_url]
    setattr(p, field, updated)
    db.commit()

    return {"deleted": image_url, "remaining": len(updated)}
