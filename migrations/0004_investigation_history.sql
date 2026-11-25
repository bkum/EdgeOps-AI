ALTER TABLE settings ADD COLUMN operator_wait_hours INTEGER NOT NULL DEFAULT 24 CHECK(operator_wait_hours BETWEEN 1 AND 168);
ALTER TABLE incidents ADD COLUMN recovery_report TEXT;
CREATE INDEX incidents_service_history ON incidents(scope, service_id, opened_at);
