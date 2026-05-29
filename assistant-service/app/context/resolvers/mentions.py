import re
import httpx
from ..schemas import ContextChunk, ContextSource, ContextScope
from .base import BaseResolver

MENTION_RE = re.compile(r"@([\w./\-]+)")

class MentionResolver(BaseResolver):
    def __init__(self, projects_service_url: str, token: str):
        self.projects_service_url = projects_service_url
        self.token = token

    def extract_paths(self, message: str) -> list[str]:
        return MENTION_RE.findall(message)

    async def resolve(self, message: str, project_id: str) -> list[ContextChunk]:
        paths = self.extract_paths(message)
        chunks = []
        async with httpx.AsyncClient() as client:
            for path in paths:
                # 1. get presigned URL from projects-service
                resp = await client.get(
                    f"{self.projects_service_url}/projects/{project_id}/files/download-url",
                    params={"path": path},
                    headers={"Authorization": f"Bearer {self.token}"},
                )
                resp.raise_for_status()
                url = resp.json()["url"]

                # 2. download content
                content_resp = await client.get(url)
                content_resp.raise_for_status()

                chunks.append(ContextChunk(
                    path=path,
                    content=content_resp.text,
                    source=ContextSource.MENTION,
                    scope=ContextScope.FULL_FILE,
                ))
        return chunks
