import { D1Database } from '@cloudflare/workers-types';

export interface Task {
  id: number;
  user_id: string;
  content: string;
  emotion: string | null;
  priority: number;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: number | null;
  notes: string | null;
  location: string | null;
  repeat_rule: string | null;
  tags: string | null;
  done: number;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

export interface TaskInput {
  user_id: string;
  content: string;
  emotion?: string;
  priority?: number;
  due_date?: string | null;
  due_time?: string | null;
  estimated_minutes?: number | null;
  notes?: string | null;
  location?: string | null;
  repeat_rule?: string | null;
  tags?: string | null;
}

export type TaskUpdateInput = Partial<Omit<TaskInput, 'user_id'>> & {
  done?: number;
};

const OPTIONAL_TASK_COLUMNS: Record<string, string> = {
  due_time: 'TEXT',
  notes: 'TEXT',
  location: 'TEXT',
  repeat_rule: 'TEXT',
  tags: 'TEXT',
  updated_at: 'TEXT',
  completed_at: 'TEXT',
};

let taskSchemaReady = false;

async function ensureTaskSchema(db: D1Database): Promise<void> {
  if (taskSchemaReady) return;

  const { results } = await db.prepare('PRAGMA table_info(tasks)').all<{ name: string }>();
  const existingColumns = new Set(results.map((column) => column.name));

  for (const [column, definition] of Object.entries(OPTIONAL_TASK_COLUMNS)) {
    if (!existingColumns.has(column)) {
      await db.prepare(`ALTER TABLE tasks ADD COLUMN ${column} ${definition}`).run();
    }
  }

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_tasks_user_schedule
       ON tasks (user_id, done, due_date, due_time, priority)`
    )
    .run();

  taskSchemaReady = true;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePriority(value: number | undefined): number {
  return Math.min(5, Math.max(1, parseInt(String(value ?? 3), 10) || 3));
}

export async function createTask(db: D1Database, input: TaskInput): Promise<Task> {
  await ensureTaskSchema(db);

  const result = await db
    .prepare(
      `INSERT INTO tasks (
         user_id, content, emotion, priority, due_date, due_time, estimated_minutes,
         notes, location, repeat_rule, tags, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       RETURNING *`
    )
    .bind(
      input.user_id,
      input.content,
      normalizeOptionalText(input.emotion),
      normalizePriority(input.priority),
      normalizeOptionalText(input.due_date),
      normalizeOptionalText(input.due_time),
      input.estimated_minutes ? parseInt(String(input.estimated_minutes), 10) : null,
      normalizeOptionalText(input.notes),
      normalizeOptionalText(input.location),
      normalizeOptionalText(input.repeat_rule),
      normalizeOptionalText(input.tags)
    )
    .first<Task>();

  return result!;
}

export async function getIncompleteTasks(db: D1Database, userId: string): Promise<Task[]> {
  await ensureTaskSchema(db);

  const { results } = await db
    .prepare(
      `SELECT * FROM tasks
       WHERE user_id = ? AND done = 0
       ORDER BY COALESCE(due_date, '9999-12-31') ASC,
                COALESCE(due_time, '99:99') ASC,
                priority ASC,
                created_at DESC`
    )
    .bind(userId)
    .all<Task>();

  return results;
}

export async function getAllIncompleteTasks(db: D1Database): Promise<Task[]> {
  await ensureTaskSchema(db);

  const { results } = await db
    .prepare(
      `SELECT * FROM tasks
       WHERE done = 0
       ORDER BY COALESCE(due_date, '9999-12-31') ASC,
                COALESCE(due_time, '99:99') ASC,
                priority ASC,
                created_at DESC`
    )
    .all<Task>();

  return results;
}

export async function updateTask(
  db: D1Database,
  taskId: number,
  input: TaskUpdateInput,
  userId?: string
): Promise<Task | null> {
  await ensureTaskSchema(db);

  const allowedFields: Array<keyof TaskUpdateInput> = [
    'content',
    'emotion',
    'priority',
    'due_date',
    'due_time',
    'estimated_minutes',
    'notes',
    'location',
    'repeat_rule',
    'tags',
    'done',
  ];
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const field of allowedFields) {
    if (!(field in input) || input[field] === undefined) continue;
    setClauses.push(`${field} = ?`);
    if (field === 'priority') {
      values.push(normalizePriority(input.priority));
    } else if (field === 'estimated_minutes') {
      values.push(input.estimated_minutes ? parseInt(String(input.estimated_minutes), 10) : null);
    } else if (field === 'done') {
      values.push(input.done ? 1 : 0);
    } else {
      values.push(normalizeOptionalText(input[field] as string | null | undefined));
    }
  }

  if (setClauses.length === 0) {
    const task = await db
      .prepare(`SELECT * FROM tasks WHERE id = ?${userId ? ' AND user_id = ?' : ''}`)
      .bind(...(userId ? [taskId, userId] : [taskId]))
      .first<Task>();
    return task ?? null;
  }

  setClauses.push('updated_at = datetime(\'now\')');
  if ('done' in input) {
    setClauses.push(input.done ? 'completed_at = datetime(\'now\')' : 'completed_at = NULL');
  }

  values.push(taskId);
  if (userId) values.push(userId);

  const result = await db
    .prepare(
      `UPDATE tasks
       SET ${setClauses.join(', ')}
       WHERE id = ?${userId ? ' AND user_id = ?' : ''}
       RETURNING *`
    )
    .bind(...values)
    .first<Task>();

  return result ?? null;
}

export async function deleteTask(db: D1Database, taskId: number, userId?: string): Promise<boolean> {
  await ensureTaskSchema(db);

  const values: unknown[] = [taskId];
  if (userId) values.push(userId);

  const result = await db
    .prepare(`DELETE FROM tasks WHERE id = ?${userId ? ' AND user_id = ?' : ''}`)
    .bind(...values)
    .run();

  return result.meta.changes > 0;
}

export async function duplicateTask(
  db: D1Database,
  taskId: number,
  userId: string,
  overrides: TaskUpdateInput = {}
): Promise<Task | null> {
  await ensureTaskSchema(db);

  const source = await db
    .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
    .bind(taskId, userId)
    .first<Task>();

  if (!source) return null;

  return createTask(db, {
    user_id: source.user_id,
    content: overrides.content ?? source.content,
    emotion: overrides.emotion ?? source.emotion ?? undefined,
    priority: overrides.priority ?? source.priority,
    due_date: overrides.due_date ?? source.due_date,
    due_time: overrides.due_time ?? source.due_time,
    estimated_minutes: overrides.estimated_minutes ?? source.estimated_minutes,
    notes: overrides.notes ?? source.notes,
    location: overrides.location ?? source.location,
    repeat_rule: overrides.repeat_rule ?? source.repeat_rule,
    tags: overrides.tags ?? source.tags,
  });
}

export async function markTaskDone(db: D1Database, taskId: number): Promise<boolean> {
  await ensureTaskSchema(db);

  const result = await db
    .prepare('UPDATE tasks SET done = 1, completed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
    .bind(taskId)
    .run();

  return result.meta.changes > 0;
}

export async function registerUser(db: D1Database, userId: string, appToken: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, app_token) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET app_token = excluded.app_token`
    )
    .bind(userId, appToken)
    .run();
}
