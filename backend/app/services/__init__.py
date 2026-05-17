"""Service package exports."""

from __future__ import annotations

__all__ = ["TavilyService"]


def __getattr__(name: str):
    if name == "TavilyService":
        from .tavily_service import TavilyService

        return TavilyService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

