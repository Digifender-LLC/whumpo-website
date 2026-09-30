-- Existing reviewed imports retain their original text-only contract.
ALTER TABLE cms_import_reviews ADD COLUMN taxonomy_plan TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(taxonomy_plan) AND json_type(taxonomy_plan)='array' AND json_array_length(taxonomy_plan)<=20 AND length(CAST(taxonomy_plan AS BLOB))<=4096);
CREATE TRIGGER cms_import_taxonomy_admit BEFORE INSERT ON cms_import_reviews WHEN NEW.taxonomy_plan<>'[]' AND (
 NEW.collection<>'posts' OR NEW.source_upload_id IS NULL OR json_array_length(NEW.taxonomy_plan)=0 OR
 EXISTS(SELECT 1 FROM json_each(NEW.taxonomy_plan) t WHERE json_type(t.value)<>'object' OR (SELECT count(*) FROM json_each(t.value))<>3 OR json_extract(t.value,'$.taxonomy') NOT IN ('categories','tags') OR json_type(t.value,'$.taxonomy') IS NOT 'text' OR json_type(t.value,'$.slug') IS NOT 'text' OR json_type(t.value,'$.label') IS NOT 'text') OR
 (SELECT count(DISTINCT json_extract(value,'$.taxonomy')||':'||json_extract(value,'$.slug')) FROM json_each(NEW.taxonomy_plan))<>json_array_length(NEW.taxonomy_plan)
) BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_plan_invalid'); END;
CREATE TRIGGER cms_import_taxonomy_immutable BEFORE UPDATE OF taxonomy_plan ON cms_import_reviews WHEN NEW.taxonomy_plan<>OLD.taxonomy_plan BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_immutable'); END;
CREATE TABLE cms_import_taxonomy_jobs (
 review_id TEXT PRIMARY KEY REFERENCES cms_import_reviews(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=4096),
 state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','applied'))
);
CREATE TRIGGER cms_import_taxonomy_job_admit BEFORE INSERT ON cms_import_taxonomy_jobs WHEN NEW.state<>'prepared' OR NOT EXISTS(
 SELECT 1 FROM cms_import_reviews r JOIN projects p ON p.id=r.project_id JOIN cms_draft_requests d ON d.id=r.id
 WHERE r.id=NEW.review_id AND r.status='approved' AND r.taxonomy_plan<>'[]' AND r.user_id=p.owner_user_id AND d.item_id IS NULL AND d.user_id=r.user_id AND d.project_id=r.project_id AND d.body=r.body
 AND json_type(NEW.body)='object' AND (SELECT count(*) FROM json_each(NEW.body))=3
 AND json_extract(NEW.body,'$.draftRequestId')=r.id AND json_type(NEW.body,'$.itemId')='text' AND length(json_extract(NEW.body,'$.itemId'))=26
 AND json_extract(NEW.body,'$.itemId') NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'
 AND json_type(NEW.body,'$.terms')='array' AND json_array_length(NEW.body,'$.terms')=json_array_length(r.taxonomy_plan)
 AND (SELECT count(DISTINCT json_extract(value,'$.id')) FROM json_each(NEW.body,'$.terms'))=json_array_length(r.taxonomy_plan)
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.body,'$.terms') n WHERE json_type(n.value)<>'object' OR (SELECT count(*) FROM json_each(n.value))<>4 OR json_extract(n.value,'$.id') GLOB '*[^0-9A-HJKMNP-TV-Z]*')
 AND NOT EXISTS(SELECT 1 FROM json_each(r.taxonomy_plan) t WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.body,'$.terms') n WHERE json_extract(n.value,'$.taxonomy')=json_extract(t.value,'$.taxonomy') AND json_extract(n.value,'$.slug')=json_extract(t.value,'$.slug') AND json_extract(n.value,'$.label')=json_extract(t.value,'$.label') AND json_type(n.value,'$.id')='text' AND length(json_extract(n.value,'$.id'))=26))
) BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_job_invalid'); END;
CREATE TRIGGER cms_import_taxonomy_job_immutable BEFORE UPDATE ON cms_import_taxonomy_jobs WHEN NEW.review_id<>OLD.review_id OR NEW.body<>OLD.body OR OLD.state<>'prepared' OR NEW.state<>'applied' BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_job_immutable'); END;
CREATE TRIGGER cms_import_taxonomy_job_retained BEFORE DELETE ON cms_import_taxonomy_jobs WHEN EXISTS(SELECT 1 FROM cms_import_reviews r JOIN users u ON u.id=r.user_id WHERE r.id=OLD.review_id) BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_job_retained'); END;
-- A generic draft retry cannot make an incomplete mapped import visible.
CREATE TRIGGER cms_import_taxonomy_draft_receipt BEFORE UPDATE OF item_id ON cms_draft_requests WHEN EXISTS(SELECT 1 FROM cms_import_reviews r WHERE r.id=NEW.id AND r.taxonomy_plan<>'[]') AND NOT EXISTS(SELECT 1 FROM cms_import_taxonomy_jobs j WHERE j.review_id=NEW.id AND j.state='applied' AND json_extract(j.body,'$.itemId')=NEW.item_id) BEGIN SELECT RAISE(ABORT,'cms_import_taxonomies_incomplete'); END;
