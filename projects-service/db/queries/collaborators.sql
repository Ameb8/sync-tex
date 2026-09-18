-- name: GetCollaborator :one
SELECT * FROM project_collaborators
WHERE project_id = $1 AND user_id = $2;

-- name: CreateProjectInvite :one
INSERT INTO project_invites (id, project_id, token, role, created_by, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetProjectInviteByToken :one
SELECT * FROM project_invites WHERE token = $1;

-- name: ListActiveProjectInvites :many
SELECT * FROM project_invites
WHERE project_id = $1 AND expires_at > NOW()
ORDER BY created_at DESC;

-- name: DeleteProjectInvite :execrows
DELETE FROM project_invites
WHERE project_id = $1 AND id = $2;

-- name: CreateProjectCollaborator :one
INSERT INTO project_collaborators (project_id, user_id, role, invited_by, invited_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListProjectCollaborators :many
SELECT * FROM project_collaborators WHERE project_id = $1;

-- name: RemoveProjectCollaborator :exec
DELETE FROM project_collaborators WHERE project_id = $1 AND user_id = $2;
