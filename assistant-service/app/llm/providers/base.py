from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator


@dataclass
class LLMResponse:
    text: str
    tokens_in: int
    tokens_out: int
    model: str


class LLMClient(ABC):
    """
    Abstract base for all LLM provider clients.
    Add a new provider by subclassing this and registering it in registry.py.
    """

    @abstractmethod
    async def chat(
        self,
        messages: list[dict],   # [{"role": "user"|"assistant"|"system", "content": "..."}]
        max_tokens: int = 1000,
    ) -> LLMResponse:
        """Single-turn, returns complete response."""
        ...

    @abstractmethod
    async def stream(
        self,
        messages: list[dict],
        max_tokens: int = 1000,
    ) -> AsyncIterator[str]:
        """Streaming, yields text chunks as they arrive."""
        ...