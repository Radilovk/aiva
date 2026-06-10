CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  emotion TEXT,
  priority INTEGER DEFAULT 3,
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
