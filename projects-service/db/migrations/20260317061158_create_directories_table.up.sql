CREATE TABLE directories (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES directories(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL
    CONSTRAINT no_self_parent CHECK (parent_id IS NULL OR id <> parent_id)
);
