CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  emotion TEXT,
  priority INTEGER DEFAULT 0,
  due_date TEXT,
  due_time TEXT,
  estimated_minutes INTEGER,
  notes TEXT,
  location TEXT,
  repeat_rule TEXT,
  tags TEXT,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_schedule
ON tasks (user_id, done, due_date, due_time, priority);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  app_token TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_connections (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  scope TEXT,
  provider_user_id TEXT,
  connected_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE IF NOT EXISTS calendar_calendars (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_calendar_id TEXT NOT NULL,
  name TEXT NOT NULL,
  timezone TEXT,
  is_primary INTEGER DEFAULT 0,
  is_selected INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider, external_calendar_id)
);

CREATE TABLE IF NOT EXISTS calendar_sync_map (
  task_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_calendar_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  synced_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_conn_user
ON calendar_connections (user_id);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_user
ON calendar_sync_map (user_id, provider);
