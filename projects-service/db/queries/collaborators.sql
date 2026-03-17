-- name: GetCollaborator :one
SELECT * FROM project_collaborators
WHERE project_id = $1 AND user_id = $2;