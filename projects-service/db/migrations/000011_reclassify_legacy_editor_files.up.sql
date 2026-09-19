-- Before collaborative_text existed, the sole website text-creation path used
-- the default 'other'. The website's raw upload path explicitly uses image.
UPDATE files SET file_type = 'collaborative_text' WHERE file_type = 'other';
