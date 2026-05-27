from dataclasses import dataclass, field
from enum import Enum

class ContextSource(str, Enum):
    MENTION = "mention"   # explicit @<path>
    AUTO = "auto"         # smart selection (existing logic)
    INLINE = "inline"     # frontend-provided content (Option C later)

@dataclass
class ContextChunk:
    path: str
    content: str
    source: ContextSource

@dataclass
class ResolvedContext:
    chunks: list[ContextChunk] = field(default_factory=list)

    def to_system_prompt(self) -> str:
        if not self.chunks:
            return ""
        parts = []
        for chunk in self.chunks:
            parts.append(f"### {chunk.path}\n```\n{chunk.content}\n```")
        return "The user has included the following project files:\n\n" + "\n\n".join(parts)