from __future__ import annotations

import os
import httpx
from dataclasses import dataclass
from typing import Optional


PROJECTS_INTERNAL_API_PATH = "/projects/internal/v1"


def _projects_service_url() -> str:
    return os.environ["PROJECTS_SERVICE_URL"].rstrip("/")


def _internal_api_key() -> str:
    return os.environ["PROJECTS_INTERNAL_API_KEY"]


def _project_download_url(project_id: str, base_url: Optional[str] = None) -> str:
    """
    Build the projects-service InternalDownloadProject URL.

    PROJECTS_SERVICE_URL is the projects-service origin, e.g.
    http://projects-service:8003. The normalization keeps older local env files
    that included /projects or /projects/internal/v1 from producing bad URLs.
    """
    base = (base_url if base_url is not None else _projects_service_url()).rstrip("/")
    for suffix in (PROJECTS_INTERNAL_API_PATH, "/projects"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    return f"{base}{PROJECTS_INTERNAL_API_PATH}/project/{project_id}/download"


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
            _project_download_url(project_id),
            params=params,
            headers={"X-Api-Key": _internal_api_key()},
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
