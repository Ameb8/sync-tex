CREATE INDEX IF NOT EXISTS idx_directories_project_id ON directories(project_id);
CREATE INDEX IF NOT EXISTS idx_directories_parent_id ON directories(parent_id);
CREATE INDEX IF NOT EXISTS idx_files_directory_id ON files(directory_id);
