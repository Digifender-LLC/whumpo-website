-- Aggregate requests only: no IP, cookie, user agent, referrer or URL records.
CREATE TABLE site_traffic_daily (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 day TEXT NOT NULL CHECK(length(day)=10),
 requests INTEGER NOT NULL CHECK(requests>=0),
 PRIMARY KEY(project_id,day)
);
CREATE INDEX site_traffic_retention ON site_traffic_daily(day);
CREATE TABLE site_traffic_metadata (
 id INTEGER PRIMARY KEY CHECK(id=1),
 enabled_at TEXT NOT NULL
);
INSERT INTO site_traffic_metadata VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
