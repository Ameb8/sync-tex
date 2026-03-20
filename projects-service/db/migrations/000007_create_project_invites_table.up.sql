-- 000007_create_project_invites_table.up.sql
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