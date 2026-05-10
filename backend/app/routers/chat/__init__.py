from fastapi import APIRouter
from .webhook import router as webhook_router
from .users import router as users_router
from .templates import router as templates_router
from .advisors import router as advisors_router
from .config import router as config_router
from .web import router as web_router

chat_router = APIRouter(prefix="/api/chat", tags=["chat"])
chat_router.include_router(webhook_router)
chat_router.include_router(users_router)
chat_router.include_router(templates_router)
chat_router.include_router(advisors_router)
chat_router.include_router(config_router)
chat_router.include_router(web_router)
