CREATE TABLE showcase_projects (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id)
);