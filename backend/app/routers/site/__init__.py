from fastapi import APIRouter
from .config import router as config_router
from .public import router as public_router

site_router = APIRouter()
site_router.include_router(config_router, prefix="/api/site", tags=["site-admin"])
site_router.include_router(public_router, prefix="/api/public", tags=["public"])
