CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(trim(email)) > 0 AND email = trim(email)),
  password_hash TEXT NOT NULL CHECK (length(trim(password_hash)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  status TEXT NOT NULL DEFAULT 'to-do'
    CHECK (status IN ('to-do', 'in-progress', 'done')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS tasks_user_id_status ON tasks(user_id, status);

CREATE TRIGGER IF NOT EXISTS tasks_update_timestamp
AFTER UPDATE OF description, status, user_id ON tasks
FOR EACH ROW
BEGIN
  UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
