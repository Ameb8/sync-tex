CREATE TYPE file_type AS ENUM ('image', 'tex', 'pdf', 'other');

ALTER TABLE files
ADD COLUMN file_type file_type NOT NULL DEFAULT 'other';