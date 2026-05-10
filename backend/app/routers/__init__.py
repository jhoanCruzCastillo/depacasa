from .developers import router as developers_router
from .templates import router as templates_router
from .scrape import router as scrape_router
from .search import router as search_router
from .visual_selector import router as visual_selector_router
from .chat import chat_router
from .site import site_router
from .auth import router as auth_router
from .site_users import router as site_users_router

__all__ = [
    "developers_router", "templates_router", "scrape_router",
    "search_router", "visual_selector_router", "chat_router", "site_router",
    "auth_router", "site_users_router",
]
