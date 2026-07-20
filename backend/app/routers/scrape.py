from fastapi import APIRouter, HTTPException, status, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel

from database import get_db
from app.models import ScrapeJob, Developer, JobStatus
from app.schemas import ScrapeJobResponse

router = APIRouter(prefix="/api/scrape", tags=["scrape"])


class FieldSelectorIn(BaseModel):
    value: str
    order: int = 0


class FieldScrapeIn(BaseModel):
    name: str
    is_child_url: bool = False
    plain_text: bool = False
    is_shared: bool = False
    is_list: bool = False
    list_container: Optional[str] = None
    is_image: bool = False
    extract_attr: Optional[str] = None
    order: int = 0
    selectors: List[FieldSelectorIn] = []


class SingleFieldScrapeIn(BaseModel):
    developer_id: UUID
    url_node_id: UUID
    node_url: str
    container_selector: Optional[str] = None
    field: FieldScrapeIn


@router.post("/{developer_id}/run", response_model=ScrapeJobResponse, status_code=status.HTTP_201_CREATED)
async def start_scrape_job(
    developer_id: UUID,
    db: Session = Depends(get_db),
):
    developer = db.query(Developer).filter(Developer.id == developer_id).first()
    if not developer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Developer not found")

    job = ScrapeJob(developer_id=developer_id, status=JobStatus.PENDING)
    db.add(job)
    db.commit()
    db.refresh(job)

    try:
        from app.workers.tasks import scrape_developer_task
        scrape_developer_task.delay(str(developer_id), str(job.id))
    except Exception:
        pass

    return job


@router.get("/jobs/{job_id}", response_model=ScrapeJobResponse)
async def get_job_status(
    job_id: UUID,
    db: Session = Depends(get_db),
):
    job = db.query(ScrapeJob).filter(ScrapeJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return job


@router.get("/{developer_id}/jobs", response_model=list[ScrapeJobResponse])
async def list_jobs_by_developer(
    developer_id: UUID,
    db: Session = Depends(get_db),
):
    jobs = db.query(ScrapeJob).filter(
        ScrapeJob.developer_id == developer_id
    ).order_by(ScrapeJob.created_at.desc()).all()
    return jobs


@router.post("/field/run", status_code=status.HTTP_202_ACCEPTED)
async def run_field_scrape(
    payload: SingleFieldScrapeIn,
):
    """Enqueue a background task to scrape a single field from the current editor state."""
    try:
        from app.workers.tasks import scrape_single_field_task
        scrape_single_field_task.delay(payload.model_dump(mode="json"))
    except Exception:
        # best-effort: failure to enqueue shouldn't crash the endpoint
        pass

    return {"status": "queued"}
