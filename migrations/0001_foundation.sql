PRAGMA foreign_keys = ON;
CREATE TABLE services (
  scope TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'synthetic'), PRIMARY KEY (scope, id)
);
INSERT INTO services VALUES ('synthetic/demo', 'demo-api', 'Synthetic API', 'synthetic');
CREATE TABLE scenario_runs (
  scope TEXT NOT NULL, request_key TEXT NOT NULL, scenario TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (scope, request_key)
);
CREATE TABLE health_checks (
  scope TEXT NOT NULL, request_key TEXT NOT NULL, service_id TEXT NOT NULL,
  observed_at TEXT NOT NULL, status TEXT NOT NULL, latency_ms INTEGER NOT NULL,
  PRIMARY KEY(scope, request_key, observed_at),
  FOREIGN KEY(scope, service_id) REFERENCES services(scope, id)
);
CREATE TABLE incidents (
  scope TEXT NOT NULL, id TEXT NOT NULL, service_id TEXT NOT NULL,
  scenario TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  opened_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(scope, id), FOREIGN KEY(scope, service_id) REFERENCES services(scope, id)
);
CREATE UNIQUE INDEX one_active_incident ON incidents(scope, service_id)
  WHERE status NOT IN ('resolved', 'dismissed');
CREATE TABLE investigations (
  scope TEXT NOT NULL, id TEXT NOT NULL, incident_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', result TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY(scope, id), UNIQUE(scope, incident_id),
  FOREIGN KEY(scope, incident_id) REFERENCES incidents(scope, id)
);
CREATE TABLE dispatch_outbox (
  scope TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
  PRIMARY KEY(scope, id), FOREIGN KEY(scope, id) REFERENCES investigations(scope, id)
);
CREATE TABLE evidence (
  scope TEXT NOT NULL, id TEXT NOT NULL, investigation_id TEXT NOT NULL,
  provider TEXT NOT NULL, summary TEXT NOT NULL, observed_at TEXT NOT NULL, fetched_at TEXT NOT NULL,
  PRIMARY KEY(scope, id), FOREIGN KEY(scope, investigation_id) REFERENCES investigations(scope, id)
);
CREATE TABLE ai_calls (
  scope TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL,
  PRIMARY KEY(scope, id)
);
CREATE INDEX ai_daily ON ai_calls(day);
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX incident_history ON incidents(scope, opened_at);
CREATE INDEX evidence_run ON evidence(scope, investigation_id);
