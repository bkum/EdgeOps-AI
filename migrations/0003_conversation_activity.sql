ALTER TABLE conversations ADD COLUMN last_used_at TEXT;
UPDATE conversations SET last_used_at = created_at WHERE last_used_at IS NULL;
CREATE INDEX conversations_activity ON conversations(scope, last_used_at);
