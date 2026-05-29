from .schemas import ResolvedContext, ContextChunk, ContextSource, ContextScope
from .tracker import ContextCandidate, ContextTracker
from .resolvers.mentions import MentionResolver

class ContextAssembler:
    def __init__(self, mention_resolver: MentionResolver):
        self.mention_resolver = mention_resolver

    async def assemble(
        self,
        message: str,
        project_id: str,
        conversation_history: list[dict],
        inline_files: dict[str, str] | None = None,  # Option C hook, path→content
    ) -> ResolvedContext:
        chunks: list[ContextChunk] = []
        tracker = ContextTracker()

        def add_chunk(chunk: ContextChunk) -> None:
            candidate = ContextCandidate(
                content=chunk.content,
                scope=chunk.scope,
                source=chunk.source.value,
                file_id=chunk.file_id,
                path=chunk.path,
            )
            if tracker.add_if_allowed(candidate):
                chunks.append(chunk)

        # 1. Inline files from frontend (open in Yjs memory) — Option C, ignored for now
        for path, content in (inline_files or {}).items():
            add_chunk(ContextChunk(
                path=path,
                content=content,
                source=ContextSource.INLINE,
                scope=ContextScope.FULL_FILE,
            ))

        # 2. Explicit @mentions
        mention_chunks = await self.mention_resolver.resolve(message, project_id)
        for chunk in mention_chunks:
            add_chunk(chunk)

        # 3. Auto smart-selection (skip paths already covered)
        if hasattr(self, "auto_resolver"):
            auto_chunks = await self.auto_resolver.resolve(
                project_id=project_id,
                history=conversation_history,
                exclude_paths=tracker.included_full_paths,
                exclude_file_ids=tracker.included_full_file_ids,
            )
            for chunk in auto_chunks:
                add_chunk(chunk)

        return ResolvedContext(
            chunks=chunks,
            included_full_file_ids=set(tracker.included_full_file_ids),
            included_full_paths=set(tracker.included_full_paths),
        )
