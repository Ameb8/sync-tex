# Project downloads

The projects service exposes these authenticated, user-facing endpoints:

| Endpoint | Result |
| --- | --- |
| `GET /projects/v1/projects/:projectID/files/:fileID/download` | One file as an attachment. |
| `GET /projects/v1/projects/:projectID/directories/:dirID/download` | The selected directory as `<directory-name>.zip`. |
| `GET /projects/v1/projects/:projectID/download` | The project root as `<project-name>.zip`. |

All three require `CanRead` on the project. Owners, editors, and viewers can
download; callers without a valid JWT receive `401`, and authenticated callers
without read access receive `403`. A file or directory ID must belong to the
path's project. Cross-project IDs are reported as `404` and never expose the
other project's metadata. These are distinct from `/projects/internal/v1/*`
metadata and presigned-URL endpoints, which are not browser download APIs.

Responses use `Cache-Control: private, no-store` and a safe RFC 6266
`Content-Disposition: attachment` filename, including an UTF-8 `filename*`
parameter. File downloads retain the stored raw object's content type, or use
`text/plain; charset=utf-8` for collaborative documents. Directory and project
downloads use `application/zip`.

## Archive layout and safety

A directory ZIP has the selected directory as its top-level entry, including
empty directories. A project ZIP contains entries relative to the project's
database root, without an extra project-name directory. Paths are constructed
only from directory relationships and user-visible names, never MinIO keys.

Names are validated as single safe path components. Absolute paths, separators,
dot traversal, normalization escapes, and duplicate/ambiguous paths (including
Unicode and case-equivalent extraction paths) are rejected with a conflict
before ZIP response headers are committed. Files are streamed into ZIP entries
with a fixed copy buffer; text is deflated and already-compressed assets are
stored without recompression.

## Content consistency and failures

Raw files are read byte-for-byte from `uploads`. Collaborative text files are
classified by persisted `file_type`, not filename extension: only explicit
collaborative-text metadata is materialized through file-data-service; raw
assets must never be interpreted as Yjs updates.

When export begins, a collaborative download represents the latest state
persisted in the snapshot object plus the pending-update object. Snapshot and
pending objects are independently optional, so snapshot+pending, snapshot-only,
pending-only, and empty documents are valid. Updates buffered only inside a
live collab-service process are outside this guarantee. The materialized text
cache is reused only when its composite freshness identity matches both source
objects, including each object's presence or absence; a snapshot ETag change,
pending ETag change, appearance, or disappearance invalidates it.

The frontend first attempts its existing supported local persistence workflow
for affected files. That is not a distributed flush barrier with collab-service
and does not expand the guarantee above.

Failures detected before a response starts—such as invalid identifiers, missing
metadata, authorization failures, extraction failures, archive conflicts, or
the archive's pre-opened first object—return a recoverable JSON error. A later
source object can fail only after a streamed ZIP has begun, when HTTP status and
headers cannot be changed; the service terminates the stream, closes source
objects, and records only safe operational identifiers. Client cancellation is
propagated to storage/extraction work. Synchronous ZIPs are therefore bounded
in service memory but remain limited by request lifetime, storage throughput,
and client connection lifetime. Asynchronous export jobs, reusable artifacts,
and one-time download tickets are future scaling options, not part of this API.
