from dataclasses import dataclass, field

from .schemas import ContextScope


@dataclass
class ContextCandidate:
    content: str
    scope: ContextScope
    source: str
    file_id: str | None = None
    path: str | None = None
    metadata: dict = field(default_factory=dict)


@dataclass
class ContextTracker:
    """Tracks full-file context already included in the current prompt."""

    included_full_file_ids: set[str] = field(default_factory=set)
    included_full_paths: set[str] = field(default_factory=set)

    def add_if_allowed(self, candidate: ContextCandidate) -> bool:
        """
        Return True when the candidate should be included.

        A candidate is skipped when the same full file has already been
        included, because adding another full file or chunk from that file would
        waste context tokens.
        """
        if self.full_file_already_included(
            file_id=candidate.file_id,
            path=candidate.path,
        ):
            return False

        if candidate.scope == ContextScope.FULL_FILE:
            self.mark_full_file_included(
                file_id=candidate.file_id,
                path=candidate.path,
            )

        return True

    def full_file_already_included(
        self,
        *,
        file_id: str | None = None,
        path: str | None = None,
    ) -> bool:
        if file_id and file_id in self.included_full_file_ids:
            return True

        if path and normalize_path(path) in self.included_full_paths:
            return True

        return False

    def mark_full_file_included(
        self,
        *,
        file_id: str | None = None,
        path: str | None = None,
    ) -> None:
        if file_id:
            self.included_full_file_ids.add(file_id)
        if path:
            self.included_full_paths.add(normalize_path(path))


def normalize_path(path: str) -> str:
    return "/".join(part for part in path.strip().lstrip("/").split("/") if part)
