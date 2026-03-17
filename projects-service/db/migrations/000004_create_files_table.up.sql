CREATE TABLE files (
    id UUID PRIMARY KEY,
    directory_id UUID NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    storage_key VARCHAR(1024) NOT NULL
);