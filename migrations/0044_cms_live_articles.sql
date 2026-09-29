CREATE VIEW cms_live_articles AS
 SELECT r.id AS publication_id,r.project_id,r.user_id,r.collection,r.item_id,r.public_html,r.digest,json_extract(r.snapshot,'$.item.data.title') AS title,r.created_at
 FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id JOIN cms_instances c ON c.project_id=r.project_id
 WHERE r.status='published' AND r.withdrawn=0 AND p.owner_user_id=r.user_id AND c.state='ready';
CREATE VIEW project_service_status AS
 SELECT service.*,CASE WHEN site_live=1 OR cms_articles>0 THEN 'live' WHEN status='live' THEN 'draft' ELSE status END AS service_status
 FROM (SELECT p.*,EXISTS(SELECT 1 FROM publications s WHERE s.project_id=p.id AND s.version_id IS NOT NULL) AS site_live,(SELECT count(*) FROM cms_live_articles c WHERE c.project_id=p.id) AS cms_articles FROM projects p) service;
