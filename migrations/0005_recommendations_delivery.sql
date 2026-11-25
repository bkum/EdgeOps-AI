CREATE TABLE recommendations (scope TEXT NOT NULL, id TEXT NOT NULL, incident_id TEXT NOT NULL, attempt INTEGER NOT NULL, position INTEGER NOT NULL, action TEXT NOT NULL, rationale TEXT, evidence_ids TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL, disposition TEXT NOT NULL DEFAULT 'proposed' CHECK(disposition IN ('proposed','accepted','rejected','done')), disposition_note TEXT, disposition_by TEXT, disposition_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, PRIMARY KEY(scope,id), FOREIGN KEY(scope,incident_id) REFERENCES incidents(scope,id));
CREATE INDEX recommendations_incident ON recommendations(scope,incident_id,attempt,position);
CREATE TABLE notification_deliveries (scope TEXT NOT NULL, notification_id TEXT NOT NULL, destination TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT, sent_at TEXT, created_at TEXT NOT NULL, PRIMARY KEY(scope,notification_id,destination), FOREIGN KEY(scope,notification_id) REFERENCES notifications(scope,id));
CREATE INDEX notification_deliveries_due ON notification_deliveries(scope,destination,state,next_attempt_at);
CREATE INDEX notifications_page ON notifications(scope,created_at,id);
CREATE INDEX knowledge_page ON knowledge_entries(scope,confirmed_at,id);
CREATE INDEX audit_page ON audit_logs(scope,id);
CREATE INDEX incidents_page ON incidents(scope,opened_at,id);
