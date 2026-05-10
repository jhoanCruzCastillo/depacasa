from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from app.models import Developer
from app.services import TavilyService

router = APIRouter(prefix="/api/search", tags=["search"])

tavily_service = TavilyService()


@router.get("/developers")
async def search_developers(q: str, db: Session = Depends(get_db)):
    """
    Search real estate platforms with Tavily and mark which are already registered.
    Returns: {query, key_configured, results: [{name, url, description, already_registered, developer_id?}]}
    """
    key_configured = bool(tavily_service.api_key)

    raw = await tavily_service.search_platforms(q) if key_configured else []

    # Build lookup maps from registered developers
    devs = db.query(Developer).all()
    url_map = {d.base_url.rstrip("/"): d for d in devs}
    name_map = {d.name.lower(): d for d in devs}

    results = []
    for r in raw:
        clean_url = r.get("url", "").rstrip("/")
        match = url_map.get(clean_url) or name_map.get(r.get("name", "").lower())
        results.append({
            "name": r.get("name", ""),
            "url": r.get("url", ""),
            "description": r.get("description", ""),
            "already_registered": match is not None,
            "developer_id": str(match.id) if match else None,
        })

    return {"query": q, "key_configured": key_configured, "results": results}


@router.get("/platforms")
async def search_platforms(query: str, max_results: int = 10):
    """Legacy endpoint — kept for compatibility."""
    results = await tavily_service.search_platforms(query, max_results)
    return {"query": query, "results": results}


@router.post("/verify-url")
async def verify_url(url: str):
    is_valid = await tavily_service.verify_url(url)
    return {"url": url, "reachable": is_valid}
