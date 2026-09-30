ALTER TABLE cms_publication_reviews ADD COLUMN media_manifest TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_manifest) AND json_type(media_manifest)='array' AND json_array_length(media_manifest)<=4 AND length(media_manifest)<=4096);
CREATE TABLE cms_publication_media (
 review_id TEXT NOT NULL REFERENCES cms_publication_reviews(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 size INTEGER NOT NULL CHECK(size BETWEEN 20 AND 1048576),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 PRIMARY KEY(review_id,media_id)
);
CREATE TRIGGER cms_publication_manifest_immutable BEFORE UPDATE OF media_manifest ON cms_publication_reviews WHEN NEW.media_manifest<>OLD.media_manifest BEGIN SELECT RAISE(ABORT,'cms_media_manifest_immutable'); END;
CREATE TRIGGER cms_publication_media_create AFTER INSERT ON cms_publication_reviews BEGIN
 SELECT RAISE(ABORT,'cms_media_manifest_content') WHERE (SELECT count(DISTINCT json_extract(value,'$.asset._ref')) FROM json_each(NEW.snapshot,'$.item.data.content') WHERE json_extract(value,'$._type')='image')<>json_array_length(NEW.media_manifest) OR EXISTS(SELECT 1 FROM json_each(NEW.media_manifest) m WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.item.data.content') b WHERE json_extract(b.value,'$._type')='image' AND json_extract(b.value,'$.asset._ref')=json_extract(m.value,'$.mediaId')));
 SELECT RAISE(ABORT,'cms_media_capacity') WHERE (SELECT count(*) FROM cms_publication_media)+json_array_length(NEW.media_manifest)>500;
 INSERT INTO cms_publication_media(review_id,media_id,user_id,project_id,digest,size,width,height)
 SELECT NEW.id,json_extract(value,'$.mediaId'),NEW.user_id,NEW.project_id,json_extract(value,'$.digest'),json_extract(value,'$.size'),json_extract(value,'$.width'),json_extract(value,'$.height') FROM json_each(NEW.media_manifest);
END;
CREATE TRIGGER cms_publication_media_admit BEFORE INSERT ON cms_publication_media BEGIN
 SELECT RAISE(ABORT,'cms_media_receipt_required') WHERE NEW.state<>'pending' OR NOT EXISTS(
  SELECT 1 FROM cms_media_uploads u JOIN cms_deployments d ON d.project_id=u.project_id JOIN cms_publication_reviews r ON r.id=NEW.review_id
  WHERE u.user_id=NEW.user_id AND u.project_id=NEW.project_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.status='pending'
  AND u.origin=d.origin AND d.state='connected' AND json_extract(u.result,'$.mediaId')=NEW.media_id AND u.digest=NEW.digest AND u.size=NEW.size AND u.width=NEW.width AND u.height=NEW.height
  AND EXISTS(SELECT 1 FROM json_each(r.media_manifest) m WHERE json_extract(m.value,'$.mediaId')=NEW.media_id AND json_extract(m.value,'$.digest')=NEW.digest AND json_extract(m.value,'$.size')=NEW.size AND json_extract(m.value,'$.width')=NEW.width AND json_extract(m.value,'$.height')=NEW.height)
 );
END;
CREATE TRIGGER cms_publication_media_immutable BEFORE UPDATE ON cms_publication_media WHEN NEW.review_id<>OLD.review_id OR NEW.media_id<>OLD.media_id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.digest<>OLD.digest OR NEW.size<>OLD.size OR NEW.width<>OLD.width OR NEW.height<>OLD.height OR OLD.state<>'pending' OR NEW.state<>'ready' BEGIN SELECT RAISE(ABORT,'cms_media_immutable'); END;
CREATE TRIGGER cms_publication_media_retained BEFORE DELETE ON cms_publication_media WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'cms_media_retained'); END;
CREATE TRIGGER cms_publication_media_approval BEFORE UPDATE OF status ON cms_publication_reviews WHEN NEW.status IN ('approved','published') AND (
 (SELECT count(*) FROM cms_publication_media WHERE review_id=NEW.id AND state='ready')<>json_array_length(NEW.media_manifest)
) BEGIN SELECT RAISE(ABORT,'cms_media_not_frozen'); END;
