-- name: CreateDirectory :one
INSERT INTO directories (id, project_id, parent_id, name)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetDirectory :one
SELECT * FROM directories
WHERE id = $1;

-- name: UpdateDirectory :one
UPDATE directories
SET name = $2
WHERE id = $1
RETURNING *;

-- name: DeleteDirectory :exec
DELETE FROM directories
WHERE id = $1;

-- name: ListDirectoriesByProject :many
SELECT * FROM directories
WHERE project_id = $1
ORDER BY name ASC;

-- name: ListDirectoriesByParent :many
SELECT * FROM directories
WHERE project_id = $1 AND parent_id = $2
ORDER BY name ASC;

-- name: CreateFile :one
INSERT INTO files (id, directory_id, project_id, filename, storage_key, file_type)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetFile :one
SELECT * FROM files
WHERE id = $1;

-- name: UpdateFile :one
UPDATE files
SET filename = $2
WHERE id = $1
RETURNING *;

-- name: DeleteFile :exec
DELETE FROM files
WHERE id = $1;

-- name: ListFilesByDirectory :many
SELECT * FROM files
WHERE directory_id = $1
ORDER BY filename ASC;

-- name: ListFilesByProject :many
SELECT * FROM files
WHERE project_id = $1
ORDER BY filename ASC;

-- name: DeleteProjectFiles :exec
DELETE FROM files
WHERE project_id = $1;

-- name: DeleteProjectDirectories :exec
DELETE FROM directories
WHERE project_id = $1;