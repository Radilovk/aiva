import { D1Database } from '@cloudflare/workers-types';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    emotion TEXT,
    priority INTEGER DEFAULT 3,
    due_date TEXT,
    estimated_minutes INTEGER,
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    app_token TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
];

let schemaBootstrap: Promise<void> | null = null;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (!schemaBootstrap) {
    schemaBootstrap = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await db.prepare(statement).run();
      }
    })();
  }

  await schemaBootstrap;
}
