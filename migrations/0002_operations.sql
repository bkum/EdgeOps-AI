CREATE TABLE applications (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT 'default', name TEXT NOT NULL, slug TEXT NOT NULL, UNIQUE(workspace_id,slug));
CREATE TABLE environments (scope TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id), name TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('demo','live')), UNIQUE(application_id,name));
INSERT INTO applications VALUES ('synthetic','default','Synthetic application','synthetic');
INSERT INTO applications VALUES ('trustplate','default','TrustPlate','trustplate');
INSERT INTO environments VALUES ('synthetic/demo','synthetic','Demo','demo');
INSERT INTO environments VALUES ('trustplate/production','trustplate','Production','live');
INSERT INTO services VALUES ('trustplate/production','trustplate-api','TrustPlate API','synthetic');
CREATE TABLE monitors (
 scope TEXT NOT NULL, service_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('synthetic','http')),
 target_url TEXT, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK(interval_seconds >= 60),
 slow_ms INTEGER NOT NULL DEFAULT 2000, minimum_samples INTEGER NOT NULL DEFAULT 3,
 failure_threshold INTEGER NOT NULL DEFAULT 2, expected_status INTEGER NOT NULL DEFAULT 200,
 scenario TEXT NOT NULL DEFAULT 'healthy', last_scheduled_at TEXT,
 PRIMARY KEY(scope,service_id), FOREIGN KEY(scope,service_id) REFERENCES services(scope,id)
);
INSERT INTO monitors(scope,service_id,kind) VALUES ('synthetic/demo','demo-api','synthetic');
INSERT INTO monitors(scope,service_id,kind,target_url) VALUES ('trustplate/production','trustplate-api','http','https://api.trustplate.in/health');
CREATE TABLE service_dependencies (
 scope TEXT NOT NULL, service_id TEXT NOT NULL, depends_on TEXT NOT NULL,
 PRIMARY KEY(scope,service_id,depends_on), CHECK(service_id <> depends_on),
 FOREIGN KEY(scope,service_id) REFERENCES services(scope,id), FOREIGN KEY(scope,depends_on) REFERENCES services(scope,id)
);
ALTER TABLE health_checks ADD COLUMN recorded_at TEXT;
ALTER TABLE health_checks ADD COLUMN http_status INTEGER;
ALTER TABLE health_checks ADD COLUMN category TEXT;
UPDATE health_checks SET recorded_at = (SELECT created_at FROM scenario_runs r WHERE r.scope=health_checks.scope AND r.request_key=health_checks.request_key);
CREATE INDEX checks_service ON health_checks(scope,service_id,recorded_at DESC);
ALTER TABLE incidents ADD COLUMN recurrence_of TEXT;
ALTER TABLE incidents ADD COLUMN resolved_at TEXT;
ALTER TABLE incidents ADD COLUMN cause_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE incidents ADD COLUMN confirmed_cause TEXT;
CREATE TABLE incident_events (
 scope TEXT NOT NULL, id TEXT NOT NULL, incident_id TEXT NOT NULL, action TEXT NOT NULL,
 payload TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, expected_version INTEGER NOT NULL,
 PRIMARY KEY(scope,id), FOREIGN KEY(scope,incident_id) REFERENCES incidents(scope,id)
);
CREATE TABLE knowledge_entries (
 scope TEXT NOT NULL, id TEXT NOT NULL, incident_id TEXT NOT NULL, content TEXT NOT NULL,
 confirmed_by TEXT NOT NULL, confirmed_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(scope,id), UNIQUE(scope,incident_id), FOREIGN KEY(scope,incident_id) REFERENCES incidents(scope,id)
);
CREATE TABLE integrations (
 scope TEXT NOT NULL, provider TEXT NOT NULL, service_id TEXT NOT NULL,
 config TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'unverified',
 last_checked_at TEXT, safe_error TEXT, PRIMARY KEY(scope,provider,service_id),
 FOREIGN KEY(scope,service_id) REFERENCES services(scope,id)
);
CREATE TABLE telemetry (
 scope TEXT NOT NULL, id TEXT NOT NULL, service_id TEXT NOT NULL, provider TEXT NOT NULL,
 kind TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, observed_at TEXT NOT NULL,
 fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(scope,id),
 FOREIGN KEY(scope,service_id) REFERENCES services(scope,id)
);
CREATE INDEX telemetry_scope ON telemetry(scope,kind,fetched_at DESC);
ALTER TABLE ai_calls ADD COLUMN status TEXT NOT NULL DEFAULT 'reserved';
ALTER TABLE ai_calls ADD COLUMN input_tokens INTEGER;
ALTER TABLE ai_calls ADD COLUMN output_tokens INTEGER;
ALTER TABLE ai_calls ADD COLUMN mode TEXT;
ALTER TABLE ai_calls ADD COLUMN created_at TEXT;
CREATE TABLE settings (
 scope TEXT PRIMARY KEY REFERENCES environments(scope), daily_ai_limit INTEGER NOT NULL DEFAULT 10 CHECK(daily_ai_limit BETWEEN 0 AND 100),
 ai_enabled INTEGER NOT NULL DEFAULT 1 CHECK(ai_enabled IN (0,1)), input_price REAL, output_price REAL,
 currency TEXT NOT NULL DEFAULT 'USD', price_checked_at TEXT, retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 180)
);
INSERT INTO settings(scope) SELECT scope FROM environments;
CREATE TABLE notifications (
 scope TEXT NOT NULL, id TEXT NOT NULL, incident_id TEXT NOT NULL, title TEXT NOT NULL,
 read_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY(scope,id),
 FOREIGN KEY(scope,incident_id) REFERENCES incidents(scope,id)
);
CREATE TABLE scheduler_leases (scope TEXT NOT NULL, service_id TEXT NOT NULL, tick INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(scope,service_id,tick));
ALTER TABLE scenario_runs ADD COLUMN service_id TEXT NOT NULL DEFAULT 'demo-api';
ALTER TABLE settings ADD COLUMN memory_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE conversations (scope TEXT NOT NULL, id TEXT NOT NULL, agent_name TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, maintained_at TEXT, PRIMARY KEY(scope,id,actor));
ALTER TABLE scenario_runs ADD COLUMN incident_id TEXT;
ALTER TABLE investigations ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE investigations ADD COLUMN workflow_id TEXT;
UPDATE investigations SET workflow_id=id;
CREATE TRIGGER dependency_cycle_guard BEFORE INSERT ON service_dependencies
WHEN EXISTS (
 WITH RECURSIVE reachable(id) AS (
  SELECT NEW.depends_on
  UNION
  SELECT d.depends_on FROM service_dependencies d JOIN reachable r ON d.service_id=r.id WHERE d.scope=NEW.scope
 ) SELECT 1 FROM reachable WHERE id=NEW.service_id
)
BEGIN SELECT RAISE(ABORT,'dependency cycle'); END;
