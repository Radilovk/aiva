CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  emotion TEXT,
  priority INTEGER DEFAULT 3,
  due_date TEXT,
  estimated_minutes INTEGER,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  app_token TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
