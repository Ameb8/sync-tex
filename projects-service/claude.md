# projects-service + postgres-projects

Go/Gin. Owns all file and project metadata. Interfaces with MinIO for object storage and issues presigned URLs.

## DB

PostgreSQL instance `postgres-projects`. Migrations via `golang-migrate`. Queries generated with `sqlc`. Stores projects, files, collaborators, invite links.

Schema highlights:
- `projects`: id (UUID), owner_id (string = JWT `sub`), name, created_at
- `files`: id (UUID), project_id, path, minio_key, etag, text_cache, text_cache_etag
- `collaborators`: project_id, user_id, role
- `invite_links`: token, project_id, expires_at

## MinIO

- Each file's Yjs update log and snapshot stored under a deterministic key. Multiple versions are stored for ech file. Each uses the same key but different buckets
- Presigned URLs generated with **internal** MinIO hostname, then rewritten to external hostname before returning to client. nginx does not proxy MinIO payloads.
- ETag-based text cache: `files.text_cache` stores last extracted plain text; invalidated when MinIO ETag differs from `files.text_cache_etag`.

### Buckets

- **Uploads**: Single file containing update log of Yjs binary updates, each prefixed by their length in bytes.

- **Snapshot**: Compressed Yjs binary document state.

- **Text**: Textual representation of a file. Only updated when text version is requested

Uploads and Snapshots both serve as source of truth for document. Full document state is aaccesssed by applying all updaates to snapshot.

## Endpoints

| **Method** | **Endpoint** | **Description** |
|------------|--------------|-----------------|
| GET    | /health                                                  | Health check endpoint                                |
| GET    | /projects/v1/projects                                    | List accessible projects (optionally filter by owned)|
| POST   | /projects/v1/projects                                    | Create a new project                                 |
| GET    | /projects/v1/projects/{projectID}                        | Get project details                                  |
| PATCH  | /projects/v1/projects/{projectID}                        | Update project name                                  |
| DELETE | /projects/v1/projects/{projectID}                        | Delete a project                                     |
| GET    | /projects/v1/projects/{projectID}/tree                   | Get full nested filesystem tree of a project         |
| GET    | /projects/v1/access                                      | Get caller's role/permission on a project            |
| POST   | /projects/v1/projects/{projectID}/directories            | Create a new directory                               |
| PATCH  | /projects/v1/projects/{projectID}/directories/{dirID}    | Update directory name                                |
| DELETE | /projects/v1/projects/{projectID}/directories/{dirID}    | Delete a directory                                   |
| POST   | /projects/v1/projects/{projectID}/files                  | Create a new file (returns presigned upload URL)     |
| GET    | /projects/v1/projects/{projectID}/files/{fileID}         | Get file metadata                                    |
| PATCH  | /projects/v1/projects/{projectID}/files/{fileID}         | Update file filename                                 |
| DELETE | /projects/v1/projects/{projectID}/files/{fileID}         | Delete a file                                        |
| POST   | /projects/v1/projects/{projectID}/files/{fileID}/upload  | Get presigned upload URL for an existing file        |
| GET    | /projects/v1/projects/{projectID}/collaborators          | List project collaborators                           |
| DELETE | /projects/v1/projects/{projectID}/collaborators/{userID} | Remove a collaborator (owner only)                   |
| POST   | /projects/v1/projects/{projectID}/invites                | Create a collaboration invite                        |
| POST   | /projects/v1/invites/accept                              | Accept a collaboration invite                        |
| GET    | /projects/v1/invites/join                                | Join via invite link (redirects to frontend)         |
| GET    | /internal/file/{fileID}/download                         | Internal - Get presigned download URL(s) for a file  |
| GET    | /internal/file/{fileID}/upload                           | Internal - Get presigned upload URL for a file       |
| GET    | /internal/file/{fileID}/compact                          | Internal - Trigger Yjs document compaction           |

## Env

```
DATABASE_URL
MINIO_ENDPOINT          # internal Docker hostname
MINIO_EXTERNAL_ENDPOINT # rewritten into presigned URLs returned to clients
MINIO_ACCESS_KEY
MINIO_SECRET_KEY
MINIO_BUCKET
JWT_SECRET
```