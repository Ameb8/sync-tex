from __future__ import annotations
import re
from dataclasses import dataclass, field

# Ordered from highest to lowest level
SECTION_COMMANDS = [
    "part",
    "chapter",
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "subparagraph",
]

LEVEL = {cmd: i for i, cmd in enumerate(SECTION_COMMANDS)}

# Matches \section{Title}, \section*{Title}, \section[Short]{Title}
HEADING_RE = re.compile(
    r"^\s*\\("
    + "|".join(SECTION_COMMANDS)
    + r")\*?"           # optional star (unnumbered)
    r"(?:\[[^\]]*\])?"  # optional short title [...]
    r"\{([^}]*)\}",     # required title {Title}
    re.MULTILINE,
)

COMMENT_RE = re.compile(r"(?<!\\)%.*$", re.MULTILINE)


@dataclass
class Chunk:
    # Ordered list of (command, title) from outermost to innermost heading.
    # e.g. [("chapter", "Introduction"), ("section", "Motivation")]
    hierarchy: list[tuple[str, str]]
    text: str                        # raw LaTeX text of this chunk
    start_line: int                  # 1-indexed line number in source file
    end_line: int


def _strip_comments(source: str) -> str:
    """Remove LaTeX line comments (unescaped %)."""
    return COMMENT_RE.sub("", source)


def _update_hierarchy(
    hierarchy: list[tuple[str, str]],
    command: str,
    title: str,
) -> list[tuple[str, str]]:
    """
    Return a new hierarchy with everything at or below `command` replaced.

    e.g. if current hierarchy is [chapter, section, subsection] and we hit
    a new \\section, we keep chapter and replace section + below.
    """
    new_level = LEVEL[command]
    # Keep only ancestors (strictly higher level = lower index number)
    trimmed = [(cmd, t) for cmd, t in hierarchy if LEVEL[cmd] < new_level]
    trimmed.append((command, title))
    return trimmed


def chunk_latex(source: str) -> list[Chunk]:
    """
    Split a single LaTeX file into chunks at section boundaries.

    Each chunk carries the full hierarchy path so identically-named sections
    in different chapters are distinguishable.
    """
    stripped = _strip_comments(source)
    lines = source.splitlines(keepends=True)       # original (for text)
    stripped_lines = stripped.splitlines(keepends=True)  # for heading detection

    chunks: list[Chunk] = []
    current_hierarchy: list[tuple[str, str]] = []
    current_start = 0  # line index (0-based)

    def flush(end_line_exclusive: int) -> None:
        """Save accumulated lines as a chunk."""
        if end_line_exclusive <= current_start:
            return
        text = "".join(lines[current_start:end_line_exclusive]).strip()
        if not text:
            return
        chunks.append(
            Chunk(
                hierarchy=list(current_hierarchy),
                text=text,
                start_line=current_start + 1,       # 1-indexed
                end_line=end_line_exclusive,
            )
        )

    for i, stripped_line in enumerate(stripped_lines):
        m = HEADING_RE.match(stripped_line)
        if m:
            flush(i)  # save everything before this heading
            command, title = m.group(1), m.group(2).strip()
            current_hierarchy = _update_hierarchy(current_hierarchy, command, title)
            current_start = i  # new chunk starts at this heading line

    # Flush the final chunk
    flush(len(lines))

    return chunks


# ── Helpers for downstream use ────────────────────────────────────────────────

def hierarchy_path(chunk: Chunk, sep: str = " > ") -> str:
    """
    Human-readable breadcrumb, e.g.:
      'Introduction > Motivation > Why This Matters'
    """
    return sep.join(title for _, title in chunk.hierarchy)


def chunk_identifier(file_id: str, chunk: Chunk) -> dict:
    """
    Compact identifier you can store alongside the embedding in the vector DB.
    Enough info to:
      - Know which file it came from
      - Retrieve fresh text from projects-service when the embedding is used
      - Disambiguate identically-named sections
    """
    return {
        "file_id": file_id,
        "hierarchy": chunk.hierarchy,   # [["chapter", "Intro"], ["section", "Motivation"]]
        "start_line": chunk.start_line,
        "end_line": chunk.end_line,
    }