from __future__ import annotations

import os
import httpx
from dataclasses import dataclass
from typing import Optional


PROJECTS_SERVICE_URL = os.environ["PROJECTS_SERVICE_URL"]
INTERNAL_API_KEY = os.environ["PROJECTS_INTERNAL_API_KEY"]


@dataclass
class ProjectFile:
    id: str
    filename: str
    file_type: str
    text_url: Optional[str] = None  # only present when requested


async def get_project_files(
    project_id: str,
    *,
    with_text_urls: bool = True,
) -> list[ProjectFile]:
    """
    Fetch all files for a project from projects-service.
    Pass with_text_urls=True to get presigned MinIO URLs for text extractions.
    """
    params = {"type": "text"} if with_text_urls else {}

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{PROJECTS_SERVICE_URL}/internal/project/{project_id}/download",
            params=params,
            headers={"X-Api-Key": INTERNAL_API_KEY},
            timeout=30.0,
        )
        response.raise_for_status()

    data = response.json()

    return [
        ProjectFile(
            id=f["id"],
            filename=f["filename"],
            file_type=f["file_type"],
            text_url=f.get("urls", {}).get("text"),
        )
        for f in data["files"]
    ]


async def fetch_file_text(text_url: str) -> str:
    """
    Download the extracted text content from a presigned MinIO URL.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(text_url, timeout=30.0)
        response.raise_for_status()
    return response.text