CREATE TABLE version_photos (
 version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 3),
 alt TEXT NOT NULL CHECK(length(alt) BETWEEN 1 AND 200),
 PRIMARY KEY(version_id,file_id),
 UNIQUE(version_id,position)
);
CREATE TRIGGER version_photo_owner BEFORE INSERT ON version_photos
BEGIN
 SELECT RAISE(ABORT,'version_photo_owner') WHERE NOT EXISTS(SELECT 1 FROM site_versions v JOIN project_files f ON f.project_id=v.project_id WHERE v.id=NEW.version_id AND f.id=NEW.file_id AND f.status='ready');
END;
CREATE TRIGGER version_photo_immutable BEFORE UPDATE ON version_photos
BEGIN SELECT RAISE(ABORT,'version_photo_immutable'); END;
CREATE TABLE storage_usage (
 period TEXT PRIMARY KEY,
 read_ops INTEGER NOT NULL DEFAULT 0 CHECK(read_ops BETWEEN 0 AND 100000),
 write_ops INTEGER NOT NULL DEFAULT 0 CHECK(write_ops BETWEEN 0 AND 10000)
);
