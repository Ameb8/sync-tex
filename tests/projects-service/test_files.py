"""
test_files.py — black-box tests for file and directory endpoints.

Endpoints covered:
    POST   /projects/v1/projects/{projectID}/files
    GET    /projects/v1/projects/{projectID}/files/{fileID}
    PATCH  /projects/v1/projects/{projectID}/files/{fileID}
    DELETE /projects/v1/projects/{projectID}/files/{fileID}
    POST   /projects/v1/projects/{projectID}/files/{fileID}/upload
    POST   /projects/v1/projects/{projectID}/directories
    PATCH  /projects/v1/projects/{projectID}/directories/{dirID}
    DELETE /projects/v1/projects/{projectID}/directories/{dirID}
"""

import uuid
import pytest
import requests


# ── Helpers ───────────────────────────────────────────────────────────────────

def create_file(base_url, proj_id, headers, filename="test.txt", directory_id=None, file_type="tex"):
    body = {"filename": filename, "file_type": file_type}
    if directory_id is not None:
        body["directory_id"] = directory_id
    return requests.post(
        f"{base_url}/projects/v1/projects/{proj_id}/files",
        json=body,
        headers=headers,
    )


def create_directory(base_url, proj_id, headers, name="subdir", path="/"):
    return requests.post(
        f"{base_url}/projects/v1/projects/{proj_id}/directories",
        json={"name": name, "path": path},
        headers=headers,
    )


# ── File tests ─────────────────────────────────────────────────────────────────

class TestCreateFile:
    def test_create_file_returns_201_and_presigned_url(self, base_url, project):
        proj, headers = project
        r = create_file(base_url, proj["id"], headers, filename="hello.txt")
        assert r.status_code == 201
        data = r.json()
        assert "id" in data
        # Service should return a presigned upload URL
        upload_url = data.get("upload_url") or data.get("uploadUrl") or data.get("url")
        assert upload_url is not None, f"Expected a presigned URL in response: {data}"

    def test_create_file_without_auth_returns_401(self, base_url, project):
        proj, _ = project
        r = create_file(base_url, proj["id"], headers={}, filename="nope.txt")
        assert r.status_code == 401

    def test_create_file_non_member_returns_403_or_404(
        self, base_url, project, second_user
    ):
        proj, _ = project
        _, headers_b = second_user
        r = create_file(base_url, proj["id"], headers_b, filename="intruder.txt")
        assert r.status_code in (403, 404)


class TestGetFile:
    def test_get_file_metadata(self, base_url, project):
        proj, headers = project
        # Create a file first
        r = create_file(base_url, proj["id"], headers, filename="readable.txt")
        assert r.status_code == 201
        file_id = r.json()["id"]

        r = requests.get(
            f"{base_url}/projects/v1/projects/{proj['id']}/files/{file_id}",
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["id"] == file_id

    def test_get_nonexistent_file_returns_404(self, base_url, project):
        proj, headers = project
        r = requests.get(
            f"{base_url}/projects/v1/projects/{proj['id']}/files/{uuid.uuid4()}",
            headers=headers,
        )
        assert r.status_code == 404


class TestUpdateFile:
    def test_rename_file(self, base_url, project):
        proj, headers = project
        r = create_file(base_url, proj["id"], headers, filename="original.txt")
        assert r.status_code == 201
        file_id = r.json()["id"]

        r = requests.patch(
            f"{base_url}/projects/v1/projects/{proj['id']}/files/{file_id}",
            json={"filename": "renamed.txt"},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["filename"] == "renamed.txt"

    def test_rename_by_non_member_returns_403_or_404(
        self, base_url, project, second_user
    ):
        proj, headers = project
        _, headers_b = second_user
        r = create_file(base_url, proj["id"], headers, filename="mine.txt")
        file_id = r.json()["id"]

        r = requests.patch(
            f"{base_url}/projects/v1/projects/{proj['id']}/files/{file_id}",
            json={"name": "stolen.txt"},
            headers=headers_b,
        )
        assert r.status_code in (403, 404)


class TestDeleteFile:
    def test_delete_file(self, base_url, project):
        proj, headers = project
        r = create_file(base_url, proj["id"], headers, filename="bye.txt")
        assert r.status_code == 201
        file_id = r.json()["id"]

        r = requests.delete(
            f"{base_url}/projects/v1/projects/{proj['id']}/files/{file_id}",
            headers=headers,
        )
        assert r.status_code in (200, 204)

        # Confirm gone
        r = requests.get(
            f"{base_url}/projects/v1/projects/{proj['id']}/files/{file_id}",
            headers=headers,
        )
        assert r.status_code == 404


class TestUploadURL:
    def test_get_upload_url_for_existing_file(self, base_url, project):
        proj, headers = project
        r = create_file(base_url, proj["id"], headers, filename="uploadme.txt")
        assert r.status_code == 201
        file_id = r.json()["id"]

        r = requests.post(
            f"{base_url}/projects/v1/projects/{proj['id']}/files/{file_id}/upload",
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        upload_url = data.get("upload_url") or data.get("uploadUrl") or data.get("url")
        assert upload_url is not None, f"Expected presigned URL: {data}"

    def test_upload_url_non_member_returns_403_or_404(
        self, base_url, project, second_user
    ):
        proj, headers = project
        _, headers_b = second_user
        r = create_file(base_url, proj["id"], headers, filename="secure.txt")
        file_id = r.json()["id"]

        r = requests.post(
            f"{base_url}/projects/v1/projects/{proj['id']}/files/{file_id}/upload",
            headers=headers_b,
        )
        assert r.status_code in (403, 404)


# ── Directory tests ────────────────────────────────────────────────────────────

class TestCreateDirectory:
    def test_create_directory_returns_2xx(self, base_url, project):
        proj, headers = project
        r = create_directory(base_url, proj["id"], headers, name="docs")
        assert r.status_code in (200, 201)
        data = r.json()
        assert "id" in data

    def test_create_directory_without_auth_returns_401(self, base_url, project):
        proj, _ = project
        r = create_directory(base_url, proj["id"], headers={}, name="nope")
        assert r.status_code == 401

    def test_create_directory_non_member_returns_403_or_404(
        self, base_url, project, second_user
    ):
        proj, _ = project
        _, headers_b = second_user
        r = create_directory(base_url, proj["id"], headers_b, name="intruder")
        assert r.status_code in (403, 404)


class TestUpdateDirectory:
    def test_rename_directory(self, base_url, project):
        proj, headers = project
        r = create_directory(base_url, proj["id"], headers, name="old-name")
        assert r.status_code in (200, 201)
        dir_id = r.json()["id"]

        r = requests.patch(
            f"{base_url}/projects/v1/projects/{proj['id']}/directories/{dir_id}",
            json={"name": "new-name"},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "new-name"


class TestDeleteDirectory:
    def test_delete_directory(self, base_url, project):
        proj, headers = project
        r = create_directory(base_url, proj["id"], headers, name="to-delete")
        assert r.status_code in (200, 201)
        dir_id = r.json()["id"]

        r = requests.delete(
            f"{base_url}/projects/v1/projects/{proj['id']}/directories/{dir_id}",
            headers=headers,
        )
        assert r.status_code in (200, 204)

    def test_delete_directory_non_member_returns_403_or_404(
        self, base_url, project, second_user
    ):
        proj, headers = project
        _, headers_b = second_user
        r = create_directory(base_url, proj["id"], headers, name="mine")
        dir_id = r.json()["id"]

        r = requests.delete(
            f"{base_url}/projects/v1/projects/{proj['id']}/directories/{dir_id}",
            headers=headers_b,
        )
        assert r.status_code in (403, 404)