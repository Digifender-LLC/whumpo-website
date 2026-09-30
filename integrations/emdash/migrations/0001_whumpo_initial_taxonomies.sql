-- Native EmDash 1.0.1 only. Never apply to the platform control database.
CREATE TABLE IF NOT EXISTS _townhello_initial_taxonomies (
 id TEXT PRIMARY KEY REFERENCES _townhello_requests(id),
 draft_request_id TEXT NOT NULL UNIQUE REFERENCES _townhello_draft_identities(request_id),
 item_id TEXT NOT NULL UNIQUE,
 body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=4096),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)
-- statement
CREATE TRIGGER IF NOT EXISTS _townhello_initial_taxonomy_guard_v1 BEFORE INSERT ON _townhello_initial_taxonomies BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM _townhello_draft_identities i JOIN _townhello_requests r ON r.id=i.request_id JOIN ec_posts p ON p.id=NEW.item_id
  WHERE i.request_id=NEW.draft_request_id AND i.collection='posts' AND p.slug=i.slug
  AND r.status BETWEEN 200 AND 299 AND json_extract(r.response,'$.success')=1 AND json_extract(r.response,'$.data.item.id')=p.id
  AND p.status='draft' AND p.version=1 AND p.locale='en' AND p.translation_group=p.id
  AND p.deleted_at IS NULL AND p.draft_revision_id IS NULL AND p.live_revision_id IS NULL AND p.published_at IS NULL AND p.scheduled_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM content_taxonomies c WHERE c.collection='posts' AND c.entry_id=p.translation_group)
 ) THEN RAISE(ABORT,'initial_draft_changed') END;
 SELECT CASE WHEN json_array_length(NEW.body,'$.terms') NOT BETWEEN 1 AND 20 OR EXISTS(
  SELECT 1 FROM json_each(NEW.body,'$.terms') j WHERE NOT EXISTS(
   SELECT 1 FROM taxonomies t JOIN _emdash_taxonomy_defs d ON d.name=t.name AND d.locale='en'
   JOIN _emdash_taxonomy_def_groups g ON g.name=d.name AND g.id=d.translation_group
   WHERE t.id=json_extract(j.value,'$.id') AND t.name=json_extract(j.value,'$.taxonomy') AND t.slug=json_extract(j.value,'$.slug') AND t.label=json_extract(j.value,'$.label')
   AND t.name IN ('categories','tags') AND t.locale='en' AND t.translation_group=t.id AND t.parent_id IS NULL
   AND coalesce(json_extract(t.data,'$.description'),'')=''
   AND json_array_length(g.collections)=1 AND json_extract(g.collections,'$[0]')='posts'
   AND g.hierarchical=CASE WHEN t.name='categories' THEN 1 ELSE 0 END
   AND d.label=CASE WHEN t.name='categories' THEN 'Categories' ELSE 'Tags' END
   AND d.label_singular=CASE WHEN t.name='categories' THEN 'Category' ELSE 'Tag' END
  )
 ) THEN RAISE(ABORT,'reviewed_terms_changed') END;
END
-- statement
CREATE TRIGGER IF NOT EXISTS _townhello_initial_taxonomy_apply_v1 AFTER INSERT ON _townhello_initial_taxonomies BEGIN
 INSERT INTO content_taxonomies(collection,entry_id,taxonomy_id)
 SELECT 'posts',NEW.item_id,json_extract(value,'$.id') FROM json_each(NEW.body,'$.terms');
 UPDATE ec_posts SET version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.item_id;
END
-- statement
CREATE TRIGGER IF NOT EXISTS _townhello_initial_taxonomy_immutable_v1 BEFORE UPDATE ON _townhello_initial_taxonomies BEGIN SELECT RAISE(ABORT,'initial_taxonomy_receipt_immutable'); END
