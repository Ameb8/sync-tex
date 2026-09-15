# Projects Service — System Design Document

## 1. System Overview

### 1.1 Purpose and Role
The `projects-service` is the central project and filesystem management microservice in the SyncTeX collaborative LaTeX IDE platform. It acts as the definitive source of truth for:
- User projects, hierarchical directory trees, and file metadata.
- Project-level authorization, role-based access control (RBAC), and collaborator management.
- Secure, token-based invite link generation, validation, and acceptance.
- Object storage orchestration through MinIO presigned URLs (for uploads, snapshots, and plain text representations).
- Lazy plain-text extraction synchronization and ETag-based cache invalidation.
- Coordination with `file-data-service` via gRPC for Yjs document compaction and text export.
- Collaborative state verification and user metadata enrichment via internal communications with `users-service` and `collab-service`.

The service is engineered in Go using the Gin web framework, utilizing PostgreSQL via `pgx/v5` and `sqlc` for compile-time verified database operations, MinIO Go SDK (`minio-go/v7`) for S3-compatible storage manipulation, and gRPC (`tonic`/Protobuf) for inter-service computational tasks.

---

## 2. Architecture and Technology Stack

### 2.1 Technology Stack
- **Language & Runtime**: Go (1.22+)
- **HTTP Routing & Middleware**: Gin Web Framework (`github.com/gin-gonic/gin`)
- **Database Engine**: PostgreSQL 16 (isolated dedicated instance: `postgres-projects`)
- **Database Driver & Connection Pool**: `github.com/jackc/pgx/v5` and `pgxpool`
- **Type-Safe SQL Generation**: `sqlc` (v2) emitting Go structs and interfaces over `pgx/v5`
- **Database Migrations**: `golang-migrate` (`db/migrations/*.sql`)
- **Object Storage SDK**: MinIO Go SDK (`github.com/minio/minio-go/v7`)
- **RPC Communication**: gRPC (`google.golang.org/grpc`) with Protocol Buffers (`proto3`)
- **JWT Parsing & Signature Validation**: `github.com/golang-jwt/jwt/v5`
- **Identifier Generation**: UUIDv4 (`github.com/google/uuid`) and cryptographically secure random bytes (`crypto/rand`)

### 2.2 Component Architecture
The service codebase follows a clean, modular structure organized into internal packages:

- `cmd/server/main.go`: Application entrypoint, configuration loader, dependency wire-up, HTTP server bootstrap, and graceful shutdown lifecycle coordinator (SIGINT/SIGTERM with a 25-second drain timeout).
- `internal/config`: Loads and validates environment variables into a strongly typed `Config` struct.
- `internal/db`: Initializes the `pgxpool.Pool` connection pool and instantiates `sqlc` generated query wrappers (`*db.Queries`).
- `internal/middleware`: Contains `AuthMiddleware` for JWT header parsing, HMAC signature verification against `JWT_SECRET`, claim validation (`user_id`), and Gin context injection.
- `internal/auth`: Houses `Authorizer`, encapsulating RBAC logic and hierarchical permission checks (`none`, `viewer`, `editor`, `owner`).
- `internal/storage`: Manages MinIO S3 client instantiation (`minio.New`) using static credentials.
- `internal/users`: HTTP client communicating with `users-service` over internal APIs (`GET /auth/internal/users`) authenticated via `X-Api-Key` to batch-resolve user profiles.
- `internal/compaction`: gRPC client wrapper over `CompactionServiceClient` communicating with `file-data-service` for document compaction and text extraction.
- `internal/handlers`: Controller layer handling incoming HTTP requests, input validation, transaction boundaries, URL generation, and error mapping across projects, directories, files, collaborators, invites, and internal endpoints.
- `internal/routes`: Route registration establishing public, JWT-protected (`/projects/v1/*`), and internal service-to-service (`/projects/internal/v1/*`) route groups.

---

## 3. Database Architecture & Data Model

The `projects-service` owns its dedicated PostgreSQL database (`postgres-projects`). Schema migrations are versioned sequentially and managed using `golang-migrate`.

### 3.1 Entity-Relationship Overview
<ERD-DIAGRAM>

### 3.2 Database Schema and Table Definitions

#### 3.2.1 `file_type` Enum (Migration 000005)
PostgreSQL custom ENUM type used to categorize file extensions and determine editor rendering or compilation behavior:
```sql
CREATE TYPE file_type AS ENUM ('image', 'tex', 'pdf', 'other');
```

#### 3.2.2 `projects` Table (Migration 000001)
Stores the root entity representing a LaTeX project workspace.
```sql
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    owner_id VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);
```
- `id`: Unique identifier (UUIDv4) generated upon project creation.
- `owner_id`: String identifier corresponding to the `user_id` (or `sub` claim) from the user's JWT.
- `name`: User-facing name of the project.
- `created_at`: Creation timestamp with default `NOW()`.

#### 3.2.3 `directories` Table (Migration 000003, 000006)
Represents the virtual filesystem folder hierarchy within a project.
```sql
CREATE TABLE directories (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES directories(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    CONSTRAINT no_self_parent CHECK (parent_id IS NULL OR id <> parent_id)
);

CREATE INDEX IF NOT EXISTS idx_directories_project_id ON directories(project_id);
CREATE INDEX IF NOT EXISTS idx_directories_parent_id ON directories(parent_id);
```
- `id`: Directory UUIDv4.
- `project_id`: Foreign key to `projects.id`. Cascades on project deletion.
- `parent_id`: Self-referencing foreign key to parent `directories.id`. `NULL` signifies a root-level directory. Cascades on parent directory deletion.
- `no_self_parent`: Constraint preventing a directory from being its own parent.

#### 3.2.4 `files` Table (Migrations 000004, 000005, 000006, 000008)
Maintains metadata for every file contained within project directories.
```sql
CREATE TABLE files (
    id UUID PRIMARY KEY,
    directory_id UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    storage_key VARCHAR(1024) NOT NULL,
    file_type file_type NOT NULL DEFAULT 'other',
    text_source_etag VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_files_directory_id ON files(directory_id);
```
- `id`: File UUIDv4.
- `directory_id`: Foreign key pointing to the immediate parent directory.
- `project_id`: Foreign key to `projects.id` for fast project-wide scoping.
- `filename`: Name of the file (e.g., `main.tex`, `references.bib`, `diagram.png`).
- `storage_key`: Canonical object storage identifier formatted deterministically as `<projectID>/<fileID>`.
- `file_type`: Enum (`tex`, `image`, `pdf`, `other`).
- `text_source_etag`: ETag of the `uploads` binary object from which the current plain-text representation was derived. Used for lazy cache synchronization.

#### 3.2.5 `project_collaborators` Table (Migration 000002)
Tracks users who have been granted explicit access to projects.
```sql
CREATE TABLE project_collaborators (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    invited_by VARCHAR(255),
    invited_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id),
    CHECK (role IN ('editor', 'viewer'))
);
```
- Composite Primary Key on `(project_id, user_id)` preventing duplicate collaborator assignments.
- `role`: Role constraint restricted to `editor` or `viewer`.
- `invited_by`: User ID of the project owner who generated the invite.
- `invited_at`: Timestamp recording when the collaborator joined.

#### 3.2.6 `project_invites` Table (Migration 000007)
Stores shareable, tokenized invite links created by project owners.
```sql
CREATE TABLE project_invites (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(50) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    CONSTRAINT valid_role CHECK (role IN ('editor', 'viewer'))
);

CREATE INDEX idx_project_invites_token ON project_invites(token);
CREATE INDEX idx_project_invites_project_id ON project_invites(project_id);
```
- `token`: Unique 64-character hex string generated from 32 cryptographic random bytes.
- `role`: Role to be granted upon acceptance (`editor` or `viewer`).
- `expires_at`: Expiration timestamp (default is 30 days from generation).

#### 3.2.7 `showcase_projects` Table (Migration 000009)
Maintains a curated list of system showcase or template projects.
```sql
CREATE TABLE showcase_projects (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id)
);
```
- When a user lists projects and has 0 accessible projects, the service queries `showcase_projects` and automatically seeds `viewer` rows in `project_collaborators` for the user, ensuring immediate access to onboarding templates.

---

### 3.3 Key Database Queries and Execution Strategies

#### 3.3.1 Atomic Project Initialization (Transaction)
When creating a project via `POST /projects/v1/projects`, an explicit database transaction is opened to guarantee atomic creation:
1. `INSERT INTO projects` inserts the project record with the caller as `owner_id`.
2. `INSERT INTO directories` inserts the project's root directory with `parent_id = NULL` and `name` matching the project name.
3. Transaction commits; if any step fails, the entire transaction is rolled back.

#### 3.3.2 Recursive Tree Construction via SQL CTE
To avoid N+1 query overhead when rendering project filesystems in the frontend or compiling projects, `GetProjectStructureAsJSON` fetches the entire nested directory hierarchy and all associated files in a single query using a PostgreSQL Recursive Common Table Expression (CTE):
```sql
WITH RECURSIVE dir_tree AS (
  SELECT 
    id, project_id, parent_id, name, 1 as depth
  FROM directories
  WHERE project_id = $1 AND parent_id IS NULL
  
  UNION ALL
  
  SELECT 
    d.id, d.project_id, d.parent_id, d.name, dt.depth + 1
  FROM directories d
  INNER JOIN dir_tree dt ON d.parent_id = dt.id
)
SELECT jsonb_build_object(
  'project_id', $1,
  'directories', jsonb_agg(DISTINCT jsonb_build_object(
    'id', dt.id,
    'parent_id', dt.parent_id,
    'name', dt.name,
    'depth', dt.depth
  )),
  'files', jsonb_agg(DISTINCT jsonb_build_object(
    'id', f.id,
    'directory_id', f.directory_id,
    'filename', f.filename,
    'storage_key', f.storage_key,
    'file_type', f.file_type
  )) FILTER (WHERE f.id IS NOT NULL)
) as structure
FROM dir_tree dt
LEFT JOIN files f ON dt.id = f.directory_id;
```
The Go handler parses this JSON blob into memory and reconstructs the nested node tree in $O(N)$ time using map lookups.

#### 3.3.3 Role Resolution
The query `GetUserRoleOnProject` evaluates the caller's role directly in SQL:
```sql
SELECT
    CASE
        WHEN p.owner_id = $2 THEN 'owner'
        ELSE pc.role
    END AS role
FROM projects p
LEFT JOIN project_collaborators pc ON p.id = pc.project_id AND pc.user_id = $2
WHERE p.id = $1
  AND (p.owner_id = $2 OR pc.user_id = $2);
```

---

## 4. Object Storage & MinIO Strategy

The `projects-service` is the exclusive authority within the SyncTeX architecture for managing S3/MinIO bucket operations, object lifecycle, and presigned URL issuance.

### 4.1 Tri-Bucket Storage Architecture
Every file registered in `projects-service` uses a canonical storage key: `<projectID>/<fileID>`. The same key is used across three distinct MinIO buckets:

| Bucket | Content Description | Writers | Readers |
|---|---|---|---|
| `uploads` | Append log of raw Yjs binary updates (length-prefixed update frames) or uploaded binary files (images/PDFs). | Frontend (via Presigned PUT) / `collab-service` | `collab-service`, `file-data-service`, Frontend |
| `snapshot` | Consolidated, compacted Yjs binary document state representing a compacted checkpoint. | `file-data-service` (compaction RPC) | `collab-service` (initial state hydration), `file-data-service` |
| `text` | Exported plain-text UTF-8 string extracted from the document's Yjs `Text` structure. | `file-data-service` (export RPC) | `assistant-service` (RAG / AI context), `compile-service` |

### 4.2 Presigned URL Generation and Gateway URL Rewriting
MinIO runs within the private Docker bridge network (`http://minio:9000`).
- **Internal Service Requests (`internalURL = true`)**:
  When internal microservices (`collab-service`, `file-data-service`, `assistant-service`) request upload or download URLs via `/projects/internal/v1/*`, presigned URLs retain internal hostnames (e.g., `http://minio:9000/uploads/...`) so traffic stays on the high-speed container bridge network.
- **External Client Requests (`internalURL = false`)**:
  When web clients invoke public APIs (`/projects/v1/projects/:id/tree`, `/projects/v1/projects/:id/files/:fileID/upload`), the service generates the presigned URL with MinIO's internal endpoint and replaces `http://minio:9000` with `GATEWAY_URL` (or `EXTERNAL_URL`). Clients then stream payloads directly to/from MinIO through the ingress gateway without proxying large payloads through `projects-service`.

### 4.3 URL Expiry Configurations
- **Single File Upload URLs (`/files` or `/files/:id/upload`)**: 15 minutes.
- **Tree Download URLs (`/projects/:id/tree`)**: 1 hour.
- **Internal Service Operations (Compaction, Extraction, Seeding)**: 3 minutes to 15 minutes.

### 4.4 Lazy Text Synchronization & ETag Cache Invalidation
`projects-service` maintains lazy plain-text synchronization across document edits without requiring continuous plain-text re-encoding during active editing sessions:
1. When an internal service requests plain text (`GET /projects/internal/v1/file/:fileID/download?type=text` or `GET /projects/internal/v1/project/:projectID/download?type=text`), `projects-service` executes `ensureTextUpToDate(ctx, file)`.
2. The service calls MinIO `StatObject` on bucket `uploads` with `file.StorageKey` to retrieve the current object's `ETag` (a fast metadata-only operation without downloading content).
3. If `file.text_source_etag == currentETag`, the cached text object in the `text` bucket is guaranteed fresh and `ensureTextUpToDate` returns immediately.
4. If the ETags differ or `text_source_etag` is `NULL`:
   - Presigned download URLs are generated for `snapshot` and `uploads`.
   - A presigned upload URL is generated for `text`.
   - A gRPC call `ExtractText` is dispatched to `file-data-service`.
   - Upon successful extraction, `projects-service` updates `files.text_source_etag = currentETag` in PostgreSQL.

---

## 5. Access Control and Authorization System

### 5.1 Permission Hierarchy
Permissions are hierarchical and strictly enforced:
$$\text{PermissionNone} < \text{PermissionViewer} < \text{PermissionEditor} < \text{PermissionOwner}$$

- **`PermissionViewer`**: Read project details, view directory tree, download file contents and presigned URLs, inspect collaborator list.
- **`PermissionEditor`**: All `viewer` actions plus: create directories, rename directories, delete directories, create files, rename files, delete files, request file upload URLs.
- **`PermissionOwner`**: All `editor` actions plus: update project name, delete project, create invite links, remove collaborators.

### 5.2 Authorization Evaluation Algorithm
When evaluating `Authorizer.GetUserPermission(ctx, projectID, userID)`:
1. Fetch project by `projectID`. If not found, return `PermissionNone`.
2. If `project.OwnerID == userID`, return `PermissionOwner`.
3. Query `project_collaborators` for `(projectID, userID)`.
4. If collaborator record exists, return `PermissionEditor` if `role == "editor"`, or `PermissionViewer` if `role == "viewer"`.
5. If no records match, return `PermissionNone`.

### 5.3 Authentication & JWT Handling
`AuthMiddleware` verifies incoming HTTP requests:
1. Reads `Authorization: Bearer <token>` header.
2. Validates HMAC signature using the shared `JWT_SECRET`.
3. Extracts the `user_id` claim. Accommodates both string representations and numeric representations (e.g., float64 JSON numbers converted to string representations) to prevent cross-language claim casting discrepancies.
4. Sets `"user_id"` in the Gin request context (`c.Set("user_id", userID)`).

---

## 6. Detailed API Specifications

### 6.1 Public & System Endpoints

#### `GET /health`
- **Auth**: None
- **Response**: `200 OK`
  ```json
  { "status": "ok" }
  ```

#### `GET /projects/v1/invites/join?token=<token>`
- **Auth**: None
- **Query Parameters**: `token` (string, required)
- **Behavior**: Validates token existence and expiration against `project_invites`. Redirects the user's browser with `302 Found` to `${EXTERNAL_URL}/join?token=<token>`.

---

### 6.2 Protected User APIs (`/projects/v1/*`)
All endpoints in this group require an `Authorization: Bearer <JWT>` header.

#### 6.2.1 Project Management

##### `GET /projects/v1/projects`
- **Query Parameters**: `filter=owned` (optional)
- **Behavior**:
  - If `filter=owned`: Returns all projects where `owner_id == caller_id`.
  - Default: Returns all projects owned by or shared with the caller.
  - Showcase Bootstrap: If caller has 0 accessible projects, the service automatically grants the caller `viewer` access to all IDs in `showcase_projects` and re-queries.
- **Response**: `200 OK` (Array of Project objects with `role` field).

##### `POST /projects/v1/projects`
- **Request Body**:
  ```json
  { "name": "My Dissertation" }
  ```
- **Behavior**: Opens transaction, creates project, creates root directory with identical name, commits.
- **Response**: `201 Created`
  ```json
  {
    "id": "c7a72d3e-8f2b-419b-b531-9f2cb42907be",
    "owner_id": "user_123",
    "name": "My Dissertation",
    "created_at": "2026-09-01T12:00:00Z"
  }
  ```

##### `GET /projects/v1/projects/:projectID`
- **Permission**: `viewer`, `editor`, or `owner`
- **Response**: `200 OK` (Project metadata).

##### `PATCH /projects/v1/projects/:projectID`
- **Permission**: `editor` or `owner`
- **Request Body**:
  ```json
  { "name": "Updated Dissertation Title" }
  ```
- **Response**: `200 OK` (Updated project).

##### `DELETE /projects/v1/projects/:projectID`
- **Permission**: `owner` only
- **Behavior**: Deletes project record; cascade deletes associated directories, files, collaborators, and invites.
- **Response**: `204 No Content`.

##### `GET /projects/v1/projects/:projectID/tree`
- **Permission**: `viewer`, `editor`, or `owner`
- **Behavior**: Executes recursive CTE query, builds nested directory hierarchy, generates 1-hour presigned download URLs for all files in the tree from the `uploads` bucket, checks collaboration status, resolves caller's role.
- **Response**: `200 OK`
  ```json
  {
    "project_id": "c7a72d3e-8f2b-419b-b531-9f2cb42907be",
    "tree": [
      {
        "id": "d0187857-e137-4d92-bf39-4467d028febe",
        "name": "My Dissertation",
        "children": [
          {
            "id": "e93297a8-3331-4c28-98e9-d758c08ec22e",
            "name": "chapters",
            "children": [],
            "files": [
              {
                "id": "f519541a-c5c6-43b2-9907-fcaad9a9bc05",
                "filename": "chapter1.tex",
                "file_type": "tex",
                "storage_key": "c7a72d3e-8f2b-419b-b531-9f2cb42907be/f519541a-c5c6-43b2-9907-fcaad9a9bc05",
                "download_url": "https://synctex.domain/uploads/c7a72d3e-8f2b-419b-b531-9f2cb42907be/f519541a-c5c6-43b2-9907-fcaad9a9bc05?X-Amz-..."
              }
            ]
          }
        ],
        "files": []
      }
    ],
    "is_collab": false,
    "role": "owner"
  }
  ```

---

#### 6.2.2 Directory Management

##### `POST /projects/v1/projects/:projectID/directories`
- **Permission**: `editor` or `owner`
- **Request Body**:
  ```json
  {
    "name": "figures",
    "parent_id": "d0187857-e137-4d92-bf39-4467d028febe"
  }
  ```
- **Response**: `201 Created` (Directory record).

##### `PATCH /projects/v1/projects/:projectID/directories/:dirID`
- **Permission**: `editor` or `owner`
- **Request Body**:
  ```json
  { "name": "images" }
  ```
- **Response**: `200 OK`.

##### `DELETE /projects/v1/projects/:projectID/directories/:dirID`
- **Permission**: `editor` or `owner`
- **Behavior**: Deletes directory record; cascade deletes nested child directories and files.
- **Response**: `204 No Content`.

---

#### 6.2.3 File Management

##### `POST /projects/v1/projects/:projectID/files`
- **Permission**: `editor` or `owner`
- **Request Body**:
  ```json
  {
    "filename": "intro.tex",
    "directory_id": "d0187857-e137-4d92-bf39-4467d028febe",
    "file_type": "tex"
  }
  ```
- **Behavior**: Inserts file record, generates storage key `<projectID>/<fileID>`, creates 15-minute presigned PUT URL for `uploads` bucket.
- **Response**: `201 Created`
  ```json
  {
    "id": "41505c10-0988-4228-b80c-7b4458515c0e",
    "filename": "intro.tex",
    "file_type": "tex",
    "storage_key": "c7a72d3e-8f2b-419b-b531-9f2cb42907be/41505c10-0988-4228-b80c-7b4458515c0e",
    "directory_id": "d0187857-e137-4d92-bf39-4467d028febe",
    "project_id": "c7a72d3e-8f2b-419b-b531-9f2cb42907be",
    "upload_url": "https://synctex.domain/uploads/c7a72d3e-8f2b-419b-b531-9f2cb42907be/41505c10-0988-4228-b80c-7b4458515c0e?X-Amz-..."
  }
  ```

##### `GET /projects/v1/projects/:projectID/files/:fileID`
- **Permission**: `viewer`, `editor`, or `owner`
- **Response**: `200 OK` (File record).

##### `POST /projects/v1/projects/:projectID/files/:fileID/upload`
- **Permission**: `editor` or `owner`
- **Behavior**: Generates a fresh 15-minute presigned PUT URL for an existing file.
- **Response**: `200 OK`
  ```json
  {
    "upload_url": "https://synctex.domain/uploads/c7a72d3e-8f2b-419b-b531-9f2cb42907be/41505c10-0988-4228-b80c-7b4458515c0e?X-Amz-...",
    "storage_key": "c7a72d3e-8f2b-419b-b531-9f2cb42907be/41505c10-0988-4228-b80c-7b4458515c0e"
  }
  ```

##### `PATCH /projects/v1/projects/:projectID/files/:fileID`
- **Permission**: `editor` or `owner`
- **Request Body**:
  ```json
  { "filename": "introduction_v2.tex" }
  ```
- **Response**: `200 OK`.

##### `DELETE /projects/v1/projects/:projectID/files/:fileID`
- **Permission**: `editor` or `owner`
- **Response**: `204 No Content`.

---

#### 6.2.4 Collaborators & Invites

##### `GET /projects/v1/projects/:projectID/access`
- **Permission**: Authenticated user
- **Response**:
  - `200 OK`:
    ```json
    { "allowed": true, "user_id": "user_123", "role": "editor" }
    ```
  - `403 Forbidden`:
    ```json
    { "allowed": false }
    ```

##### `GET /projects/v1/access?projectId=<projectID>`
- **Behavior**: Query-parameter alternative role resolution endpoint used by external/collaborative components.
- **Response**: `200 OK` `{ "allowed": true, "user_id": "...", "role": "owner" }` or `403 Forbidden` `{ "allowed": false }`.

##### `POST /projects/v1/projects/:projectID/invites`
- **Permission**: `owner` only
- **Request Body**:
  ```json
  { "role": "editor" }
  ```
- **Behavior**: Generates 32-byte cryptographic random token, stores invite valid for 30 days, generates shareable frontend URL `${EXTERNAL_URL}/join?token=<token>`.
- **Response**: `201 Created`
  ```json
  {
    "invite_id": "060d4a79-216e-4739-95e3-85e683f218a5",
    "token": "79b4226d7f95034...",
    "link": "https://synctex.domain/join?token=79b4226d7f95034...",
    "role": "editor",
    "expires_at": "2026-10-01T12:00:00Z"
  }
  ```

##### `POST /projects/v1/invites/accept`
- **Permission**: Authenticated user
- **Request Body**:
  ```json
  { "token": "79b4226d7f95034..." }
  ```
- **Behavior**: Validates invite token and expiration, verifies user is not already a collaborator, adds user into `project_collaborators`.
- **Response**: `200 OK` (Collaborator record).

##### `GET /projects/v1/projects/:projectID/collaborators`
- **Permission**: `viewer`, `editor`, or `owner`
- **Behavior**: Queries `project_collaborators`, gathers unique IDs (collaborators and inviters), calls `users-service` via internal HTTP client to retrieve email, name, and profile pictures, and joins data. If `users-service` is unreachable, gracefully falls back to empty user profiles.
- **Response**: `200 OK`
  ```json
  [
    {
      "project_id": "c7a72d3e-8f2b-419b-b531-9f2cb42907be",
      "user_id": "user_456",
      "role": "editor",
      "invited_by": "user_123",
      "invited_at": "2026-09-01T12:30:00Z",
      "email": "collab@domain.com",
      "name": "Jane Doe",
      "profile_pic": "https://avatars.githubusercontent.com/u/12345"
    }
  ]
  ```

##### `DELETE /projects/v1/projects/:projectID/collaborators/:userID`
- **Permission**: `owner` only (cannot remove self)
- **Response**: `204 No Content`.

---

### 6.3 Internal Endpoints (`/projects/internal/v1/*`)
Internal endpoints are designed for inter-service communication across the internal network mesh without JWT requirements.

#### `GET /projects/internal/v1/file/:fileID/download?type=uploads,snapshot,text`
- **Callers**: `collab-service`, `assistant-service`, `compile-service`
- **Query Parameters**: `type` (comma-separated: `uploads`, `snapshot`, `text`; defaults to all three).
- **Behavior**:
  - If `type` contains `text`, executes lazy ETag cache check via `ensureTextUpToDate`.
  - Generates presigned internal MinIO download URLs (15-minute expiry).
- **Response**: `200 OK`
  ```json
  {
    "uploads": "http://minio:9000/uploads/proj/file?...",
    "snapshot": "http://minio:9000/snapshot/proj/file?...",
    "text": "http://minio:9000/text/proj/file?..."
  }
  ```

#### `GET /projects/internal/v1/file/:fileID/upload?type=uploads`
- **Callers**: `collab-service`
- **Query Parameters**: `type` (`uploads`, `snapshot`, or `text`; default `uploads`).
- **Behavior**: Generates presigned internal MinIO upload URL (15-minute expiry).
- **Response**: `200 OK`
  ```json
  { "url": "http://minio:9000/uploads/proj/file?..." }
  ```

#### `GET /projects/internal/v1/file/:fileID/compact`
- **Callers**: `collab-service` (invoked when the last collaborative user leaves a document room).
- **Flow & Behavior**:
  1. Generates 3-minute internal upload URL for `snapshot`.
  2. Generates 3-minute internal download URL for existing `snapshot`.
  3. Generates 3-minute internal download URL for `uploads` (update log).
  4. Dispatches gRPC `CompactDocument` to `file-data-service`.
  5. Upon successful gRPC response, deletes the old update log from MinIO `uploads` bucket using `minioClient.RemoveObject`.
- **Response**: `200 OK` `{ "url": "<new_snapshot_upload_url>" }`.

#### `GET /projects/internal/v1/project/:projectID/download?type=uploads,snapshot,text`
- **Callers**: `assistant-service` (context retrieval & RAG), `compile-service` (compilation archive assembly).
- **Query Parameters**: `type` (optional comma-separated list). If omitted, returns file inventory without presigned URLs.
- **Behavior**: Queries all files in the project, regenerates stale text if `text` is requested, and generates internal presigned URLs.
- **Response**: `200 OK`
  ```json
  {
    "files": [
      {
        "id": "f519541a-c5c6-43b2-9907-fcaad9a9bc05",
        "filename": "main.tex",
        "file_type": "tex",
        "urls": {
          "text": "http://minio:9000/text/proj/file?..."
        }
      }
    ]
  }
  ```

---

## 7. Inter-Service Communication & Workflow Diagrams

### 7.1 Cross-Service Interactions Matrix

| Target Service | Protocol | Endpoints / Methods | Purpose |
|---|---|---|---|
| **Users Service (`users-service`)** | HTTP / REST | `GET /auth/internal/users?user_ids=...` (Header: `X-Api-Key`) | Enrich collaborator responses with email, name, and profile pictures. |
| **File Data Service (`file-data-service`)** | gRPC (`proto3`) | `CompactDocument(CompactRequest)` | Merge incremental Yjs update frames with base snapshot into a new compacted snapshot. |
| **File Data Service (`file-data-service`)** | gRPC (`proto3`) | `ExportDocument(ExportRequest)` | Extract plain UTF-8 text from Yjs snapshots and updates into the `text` bucket. |
| **MinIO Storage Engine** | S3 API | `PresignedGetObject`, `PresignedPutObject`, `StatObject`, `RemoveObject` | Generate client & internal URLs, inspect ETags for caching, purge compacted update logs. |
| **Collab Service (`collab-service`)** | Inbound HTTP | Receives calls on `/projects/internal/v1/file/:fileID/*` | State seeding, periodic upload URL fetching, room teardown compaction. |
| **Assistant Service (`assistant-service`)** | Inbound HTTP | Receives calls on `/projects/internal/v1/project/:projectID/download` | Fetch project file structure and fresh plain-text URLs for AI prompt context. |
| **Compile Service (`compile-service`)** | Inbound HTTP | Receives calls on `/projects/internal/v1/project/:projectID/download` | Download project files and images to compile LaTeX documents into PDFs. |

---

## 8. Operational Configuration & Deployment

### 8.1 Environment Variables Reference

| Variable | Description | Default / Example | Required |
|---|---|---|---|
| `PORT` | HTTP port on which the Gin server listens. | `8003` | No |
| `DATABASE_URL` | PostgreSQL connection string for `postgres-projects`. | `postgres://postgres:postgres@postgres-projects:5432/projects_db?sslmode=disable` | Yes |
| `JWT_SECRET` | Secret key used to sign and verify HMAC JWT tokens. | None (`dev-secret-change-in-production` fallback) | Yes |
| `MINIO_ENDPOINT` | Internal network address of the MinIO S3 server. | `minio:9000` | Yes |
| `MINIO_ACCESS_KEY` | MinIO root or service access key. | None | Yes |
| `MINIO_SECRET_KEY` | MinIO secret key. | None | Yes |
| `GATEWAY_URL` / `EXTERNAL_URL` | Public-facing base domain used to rewrite presigned URLs and generate invite links. | `https://synctex.domain` | Yes |
| `USERS_INTERNAL_API_URL` | Internal URL for `users-service`. | `http://users-service:8001` | Yes |
| `USERS_INTERNAL_API_KEY` | Shared secret passed in `X-Api-Key` when querying `users-service`. | None | Yes |
| `FILE_DATA_ADDR` | Host and port for gRPC connection to `file-data-service`. | `file-data-service:50051` | Yes |
| `PROJECTS_INTERNAL_API_KEY`| Shared secret for securing internal endpoints. | None | Optional |

### 8.2 Deployment and Containerization
- **Dockerfile**: Multi-stage build (`golang:1.22-alpine` builder stage, `alpine:latest` minimal runner image). Statically compiled with `CGO_ENABLED=0 GOOS=linux`.
- **ARM64 Support**: Fully native compilation compatible with Raspberry Pi 5 (ARM64) and standard x86_64 host architectures.
- **Graceful Lifecycle Management**: Handles OS signals (`SIGINT`, `SIGTERM`) through a cancelable context, allowing 25 seconds to complete active HTTP requests, flush connection pools, and close gRPC channels cleanly before termination.
