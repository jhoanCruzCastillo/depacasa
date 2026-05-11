"""FastAPI application initialization and setup"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import logging

from config import settings
from database import Base, engine, run_migrations
from app.routers import (
    developers_router,
    templates_router,
    scrape_router,
    search_router,
    visual_selector_router,
    chat_router,
    site_router,
    auth_router,
    site_users_router,
)
# Import models so Base.metadata includes them for create_all
import app.models.chat_user  # noqa: F401
import app.models.chat_conversation  # noqa: F401
import app.models.chat_message  # noqa: F401
import app.models.chat_template  # noqa: F401
import app.models.sales_advisor  # noqa: F401
import app.models.chat_config  # noqa: F401
import app.models.site_config  # noqa: F401
import app.models.site_user  # noqa: F401
import app.models.web_chat_session  # noqa: F401
import app.models.user_preference  # noqa: F401
import app.models.user_property_interaction  # noqa: F401
import app.models.search_history  # noqa: F401

logger = logging.getLogger(__name__)

# Create tables then apply column-level migrations
Base.metadata.create_all(bind=engine)
run_migrations()

# Initialize FastAPI app
app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    debug=settings.DEBUG,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve downloaded media files
_MEDIA_DIR = Path("/app/media")
_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(_MEDIA_DIR)), name="media")

# Include routers
app.include_router(developers_router)
app.include_router(templates_router)
app.include_router(scrape_router)
app.include_router(search_router)
app.include_router(visual_selector_router)
app.include_router(chat_router)
app.include_router(site_router)
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(site_users_router)


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "app": settings.API_TITLE}


@app.get("/api/health")
async def api_health_check():
    """Health check endpoint (API prefix)"""
    return {"status": "ok", "app": settings.API_TITLE}


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "app": settings.API_TITLE,
        "version": settings.API_VERSION,
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )
