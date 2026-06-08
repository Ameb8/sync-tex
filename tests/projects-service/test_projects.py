"""
test_projects.py — black-box tests for project CRUD endpoints.

Endpoints covered:
    POST   /projects/v1/projects
    GET    /projects/v1/projects
    GET    /projects/v1/projects/{projectID}
    PATCH  /projects/v1/projects/{projectID}
    DELETE /projects/v1/projects/{projectID}
    GET    /projects/v1/projects/{projectID}/tree
    GET    /projects/v1/projects/{projectID}/access
"""

import uuid
import requests


class TestCreateProject:
    def test_create_returns_201_with_id(self, base_url, unique_user):
        _, headers = unique_user
        r = requests.post(
            f"{base_url}/projects/v1/projects",
            json={"name": "my-project"},
            headers=headers,
        )
        assert r.status_code == 201
        data = r.json()
        assert "id" in data
        assert data["name"] == "my-project"

    def test_create_without_auth_returns_401(self, base_url):
        r = requests.post(
            f"{base_url}/projects/v1/projects",
            json={"name": "no-auth"},
        )
        assert r.status_code == 401

    def test_create_missing_name_returns_4xx(self, base_url, unique_user):
        _, headers = unique_user
        r = requests.post(
            f"{base_url}/projects/v1/projects",
            json={},
            headers=headers,
        )
        assert r.status_code in (400, 422)


class TestListProjects:
    def test_list_returns_own_projects(self, base_url, unique_user):
        _, headers = unique_user
        # Create two projects
        for name in ("alpha", "beta"):
            requests.post(
                f"{base_url}/projects/v1/projects",
                json={"name": name},
                headers=headers,
            )
        r = requests.get(f"{base_url}/projects/v1/projects", headers=headers)
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert "alpha" in names
        assert "beta" in names

    def test_list_does_not_include_other_users_projects(
        self, base_url, unique_user, second_user
    ):
        _, headers_a = unique_user
        _, headers_b = second_user
        # User A creates a project
        r = requests.post(
            f"{base_url}/projects/v1/projects",
            json={"name": "user-a-private"},
            headers=headers_a,
        )
        assert r.status_code == 201

        # User B should not see it
        r = requests.get(f"{base_url}/projects/v1/projects", headers=headers_b)
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert "user-a-private" not in names

    def test_list_without_auth_returns_401(self, base_url):
        r = requests.get(f"{base_url}/projects/v1/projects")
        assert r.status_code == 401


class TestGetProject:
    def test_get_own_project(self, base_url, project):
        proj, headers = project
        r = requests.get(
            f"{base_url}/projects/v1/projects/{proj['id']}", headers=headers
        )
        assert r.status_code == 200
        assert r.json()["id"] == proj["id"]

    def test_get_nonexistent_project(self, base_url, unique_user):
        _, headers = unique_user
        r = requests.get(
            f"{base_url}/projects/v1/projects/{uuid.uuid4()}", headers=headers
        )
        assert r.status_code in (403, 404)

    def test_get_other_users_project_returns_403_or_404(
        self, base_url, project, second_user
    ):
        proj, _ = project
        _, headers_b = second_user
        r = requests.get(
            f"{base_url}/projects/v1/projects/{proj['id']}", headers=headers_b
        )
        assert r.status_code in (403, 404)


class TestUpdateProject:
    def test_rename_project(self, base_url, project):
        proj, headers = project
        r = requests.patch(
            f"{base_url}/projects/v1/projects/{proj['id']}",
            json={"name": "renamed"},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "renamed"

    def test_rename_by_non_owner_returns_403_or_404(
        self, base_url, project, second_user
    ):
        proj, _ = project
        _, headers_b = second_user
        r = requests.patch(
            f"{base_url}/projects/v1/projects/{proj['id']}",
            json={"name": "hacked"},
            headers=headers_b,
        )
        assert r.status_code in (403, 404)


class TestDeleteProject:
    def test_delete_own_project(self, base_url, unique_user):
        _, headers = unique_user
        # Create a dedicated project for this test
        r = requests.post(
            f"{base_url}/projects/v1/projects",
            json={"name": "to-delete"},
            headers=headers,
        )
        proj_id = r.json()["id"]

        r = requests.delete(
            f"{base_url}/projects/v1/projects/{proj_id}", headers=headers
        )
        assert r.status_code in (200, 204)

        # Confirm gone
        r = requests.get(
            f"{base_url}/projects/v1/projects/{proj_id}", headers=headers
        )
        assert r.status_code in (403, 404)

    def test_delete_by_non_owner_returns_403_or_404(
        self, base_url, project, second_user
    ):
        proj, _ = project
        _, headers_b = second_user
        r = requests.delete(
            f"{base_url}/projects/v1/projects/{proj['id']}", headers=headers_b
        )
        assert r.status_code in (403, 404)


class TestProjectTree:
    def test_tree_empty_project(self, base_url, project):
        proj, headers = project
        r = requests.get(
            f"{base_url}/projects/v1/projects/{proj['id']}/tree", headers=headers
        )
        assert r.status_code == 200
        # Tree of an empty project should be a valid (likely empty) structure

    def test_tree_without_auth_returns_401(self, base_url, project):
        proj, _ = project
        r = requests.get(f"{base_url}/projects/v1/projects/{proj['id']}/tree")
        assert r.status_code == 401


class TestAccess:
    def test_owner_has_owner_role(self, base_url, project):
        proj, headers = project
        r = requests.get(
            f"{base_url}/projects/v1/projects/{proj['id']}/access",
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["allowed"] is True
        assert data["role"] == "owner"

    def test_non_member_access_returns_403_or_404(
        self, base_url, project, second_user
    ):
        proj, _ = project
        _, headers_b = second_user
        r = requests.get(
            f"{base_url}/projects/v1/projects/{proj['id']}/access",
            headers=headers_b,
        )
        assert r.status_code in (403, 404)
        if r.status_code == 403:
            assert r.json()["allowed"] is False
