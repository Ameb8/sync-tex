from abc import ABC, abstractmethod
from ..schemas import ContextChunk

class BaseResolver(ABC):
    @abstractmethod
    async def resolve(self, **kwargs) -> list[ContextChunk]:
        ...