DROP VIEW project_service_status;
CREATE VIEW project_service_status AS
 SELECT service.*,CASE WHEN site_live=1 OR cms_articles>0 OR backend_live=1 THEN 'live' WHEN status='live' THEN 'draft' ELSE status END AS service_status
 FROM (SELECT p.*,
 EXISTS(SELECT 1 FROM publications s WHERE s.project_id=p.id AND s.version_id IS NOT NULL) AS site_live,
 (SELECT count(*) FROM cms_live_articles c WHERE c.project_id=p.id) AS cms_articles,
 EXISTS(SELECT 1 FROM backend_publications b JOIN backend_publication_reviews r ON r.id=b.review_id AND r.status='applied' WHERE b.project_id=p.id AND b.version_id IS NOT NULL AND r.user_id=p.owner_user_id) AS backend_live
 FROM projects p) service;
