from dataclasses import dataclass, field
from enum import Enum

class ContextSource(str, Enum):
    MENTION = "mention"   # explicit @<path>
    AUTO = "auto"         # smart selection (existing logic)
    INLINE = "inline"     # frontend-provided content (Option C later)
    TOOL = "tool"         # future tool-generated context

class ContextScope(str, Enum):
    FULL_FILE = "full_file"
    FILE_CHUNK = "file_chunk"

@dataclass
class ContextChunk:
    path: str
    content: str
    source: ContextSource
    file_id: str | None = None
    scope: ContextScope = ContextScope.FILE_CHUNK

@dataclass
class ResolvedContext:
    chunks: list[ContextChunk] = field(default_factory=list)
    included_full_file_ids: set[str] = field(default_factory=set)
    included_full_paths: set[str] = field(default_factory=set)

    def to_system_prompt(self) -> str:
        if not self.chunks:
            return ""
        parts = []
        for chunk in self.chunks:
            parts.append(f"### {chunk.path}\n```\n{chunk.content}\n```")
        return "The user has included the following project files:\n\n" + "\n\n".join(parts)
