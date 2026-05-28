import os
import sys
import types
import unittest
import asyncio
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.modules.setdefault("httpx", types.SimpleNamespace(AsyncClient=object))
os.environ.setdefault("PROJECTS_SERVICE_URL", "http://projects-service:8003")
os.environ.setdefault("PROJECTS_INTERNAL_API_KEY", "test-key")

from app.clients import projects_client
from app.clients.projects_client import _project_download_url, get_project_files


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"files": []}


class FakeAsyncClient:
    last_url = None
    last_kwargs = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    async def get(self, url, **kwargs):
        FakeAsyncClient.last_url = url
        FakeAsyncClient.last_kwargs = kwargs
        return FakeResponse()


class ProjectClientURLTests(unittest.TestCase):
    def test_project_download_url_uses_internal_route_from_service_base(self):
        url = _project_download_url(
            "project-123",
            base_url="http://projects-service:8003",
        )

        self.assertEqual(
            url,
            "http://projects-service:8003/projects/internal/v1/project/project-123/download",
        )

    def test_project_download_url_normalizes_legacy_internal_prefix(self):
        url = _project_download_url(
            "project-123",
            base_url="http://projects-service:8003/projects/internal/v1",
        )

        self.assertEqual(
            url,
            "http://projects-service:8003/projects/internal/v1/project/project-123/download",
        )

    def test_get_project_files_requests_text_download_urls(self):
        projects_client.httpx.AsyncClient = FakeAsyncClient

        files = asyncio.run(get_project_files("project-123", with_text_urls=True))

        self.assertEqual(files, [])
        self.assertEqual(
            FakeAsyncClient.last_url,
            "http://projects-service:8003/projects/internal/v1/project/project-123/download",
        )
        self.assertEqual(FakeAsyncClient.last_kwargs["params"], {"type": "text"})
        self.assertEqual(
            FakeAsyncClient.last_kwargs["headers"],
            {"X-Api-Key": "test-key"},
        )


if __name__ == "__main__":
    unittest.main()
