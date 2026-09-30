-- Bounded operator telemetry only; never a customer action or billing receipt.
CREATE TABLE maintenance_health (
 job TEXT PRIMARY KEY CHECK(job IN ('imports','hosting','health','fair_use','traffic','applications','contacts','photos','github','cloudflare')),
 run_id TEXT NOT NULL,
 started_at INTEGER NOT NULL CHECK(started_at>=0),
 finished_at INTEGER,
 last_success_at INTEGER,
 duration_ms INTEGER CHECK(duration_ms>=0),
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed','skipped')),
 failure_category TEXT CHECK(failure_category IS NULL OR failure_category='job_failed')
);
