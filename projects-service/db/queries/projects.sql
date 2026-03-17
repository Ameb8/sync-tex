-- name: CreateProject :one
INSERT INTO projects (id, owner_id, name, created_at)
VALUES ($1, $2, $3, NOW())
RETURNING *;


-- name: GetProject :one
SELECT * FROM projects
WHERE id = $1;


-- name: ListProjectsByOwner :many
SELECT * FROM projects
WHERE owner_id = $1
ORDER BY created_at DESC;


-- name: ListProjectsByUser :many
SELECT DISTINCT p.*
FROM projects p
LEFT JOIN project_collaborators pc ON p.id = pc.project_id
WHERE p.owner_id = $1 OR pc.user_id = $1
ORDER BY p.created_at DESC;


-- name: UpdateProjectName :one
UPDATE projects
SET name = $2
WHERE id = $1
RETURNING *;


-- name: DeleteProject :exec
DELETE FROM projects
WHERE id = $1;


-- name: GetProjectStructureAsJSON :one
WITH RECURSIVE dir_tree AS (
  SELECT 
    id,
    project_id,
    parent_id,
    name,
    1 as depth
  FROM directories
  WHERE project_id = $1 AND parent_id IS NULL
  
  UNION ALL
  
  SELECT 
    d.id,
    d.project_id,
    d.parent_id,
    d.name,
    dt.depth + 1
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