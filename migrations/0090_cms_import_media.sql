-- Old approvals keep their original scope. Image references require a complete immutable mapping.
ALTER TABLE cms_import_reviews ADD COLUMN media_plan TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_plan) AND json_type(media_plan)='array' AND json_array_length(media_plan)<=4 AND length(CAST(media_plan AS BLOB))<=24576);
CREATE TRIGGER cms_import_media_admit BEFORE INSERT ON cms_import_reviews WHEN
 json_array_length(NEW.media_plan)<>(SELECT count(*) FROM json_each(NEW.body,'$.data.content') WHERE json_extract(value,'$._type')='image') OR
 (NEW.media_plan<>'[]' AND (NEW.source_upload_id IS NULL OR
 EXISTS(SELECT 1 FROM json_each(NEW.media_plan) m WHERE
  json_type(m.value)<>'object' OR (SELECT count(*) FROM json_each(m.value))<>10 OR
  json_type(m.value,'$.position') IS NOT 'integer' OR json_extract(m.value,'$.position')<>m.key OR
  json_type(m.value,'$.sourceAttachmentId') IS NOT 'integer' OR json_extract(m.value,'$.sourceAttachmentId')<1 OR
  json_type(m.value,'$.blockKey') IS NOT 'text' OR json_type(m.value,'$.mediaId') IS NOT 'text' OR
  json_type(m.value,'$.digest') IS NOT 'text' OR json_type(m.value,'$.size') IS NOT 'integer' OR json_type(m.value,'$.width') IS NOT 'integer' OR json_type(m.value,'$.height') IS NOT 'integer' OR
  json_type(m.value,'$.sourceURL') IS NULL OR json_type(m.value,'$.sourceURL') NOT IN ('text','null') OR length(json_extract(m.value,'$.sourceURL'))>2048 OR
  json_type(m.value,'$.attachmentURL') IS NULL OR json_type(m.value,'$.attachmentURL') NOT IN ('text','null') OR length(json_extract(m.value,'$.attachmentURL'))>2048 OR
  NOT EXISTS(SELECT 1 FROM json_each(NEW.body,'$.data.content') b WHERE json_extract(b.value,'$._type')='image' AND json_extract(b.value,'$._key')=json_extract(m.value,'$.blockKey') AND json_extract(b.value,'$.asset._ref')=json_extract(m.value,'$.mediaId')) OR
  NOT EXISTS(SELECT 1 FROM cms_media_uploads u JOIN cms_deployments d ON d.project_id=u.project_id WHERE u.user_id=NEW.user_id AND u.project_id=NEW.project_id AND u.origin=d.origin AND d.state='connected' AND u.result IS NOT NULL AND json_extract(u.result,'$.mediaId')=json_extract(m.value,'$.mediaId') AND u.digest=json_extract(m.value,'$.digest') AND u.size=json_extract(m.value,'$.size') AND u.width=json_extract(m.value,'$.width') AND u.height=json_extract(m.value,'$.height'))
 ) OR (SELECT count(DISTINCT json_extract(value,'$.blockKey')) FROM json_each(NEW.media_plan))<>json_array_length(NEW.media_plan)))
BEGIN SELECT RAISE(ABORT,'cms_import_media_invalid'); END;
CREATE TRIGGER cms_import_media_immutable BEFORE UPDATE OF media_plan ON cms_import_reviews WHEN NEW.media_plan<>OLD.media_plan BEGIN SELECT RAISE(ABORT,'cms_import_media_immutable'); END;
