from .schemas import ResolvedContext, ContextChunk, ContextSource
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
        seen_paths: set[str] = set()

        # 1. Inline files from frontend (open in Yjs memory) — Option C, ignored for now
        for path, content in (inline_files or {}).items():
            chunks.append(ContextChunk(path=path, content=content, source=ContextSource.INLINE))
            seen_paths.add(path)

        # 2. Explicit @mentions
        mention_chunks = await self.mention_resolver.resolve(message, project_id)
        for chunk in mention_chunks:
            if chunk.path not in seen_paths:
                chunks.append(chunk)
                seen_paths.add(chunk.path)

        # 3. Auto smart-selection (skip paths already covered)
        auto_chunks = await self.auto_resolver.resolve(
            project_id=project_id,
            history=conversation_history,
            exclude_paths=seen_paths,
        )
        for chunk in auto_chunks:
            if chunk.path not in seen_paths:
                chunks.append(chunk)
                seen_paths.add(chunk.path)

        return ResolvedContext(chunks=chunks)