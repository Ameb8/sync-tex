CREATE TABLE project_collaborators (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    invited_by VARCHAR(255),
    invited_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id),
    CHECK (role IN ('editor', 'viewer'))
);