"""Runtime context objects used by intent handlers."""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class IntentResult:
    """Result returned by an intent handler."""

    response: dict | None = None
    continue_processing: bool = False


@dataclass
class IntentRuntime:
    """Execution context passed to every intent handler."""

    session: Any
    db: Any
    user_text: str
    state: str
    step: int | None
    ctx: dict[str, Any]
    helpers: dict[str, Callable[..., Any]]
    metadata: dict[str, Any] = field(default_factory=dict)

    def call(self, name: str, *args, **kwargs) -> Any:
        fn = self.helpers.get(name)
        if fn is None:
            raise KeyError(f"Missing helper: {name}")
        return fn(*args, **kwargs)

    async def acall(self, name: str, *args, **kwargs) -> Any:
        value = self.call(name, *args, **kwargs)
        if inspect.isawaitable(value):
            return await value
        return value

