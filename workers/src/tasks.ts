import { D1Database } from '@cloudflare/workers-types';

export interface Task {
  id: number;
  user_id: string;
  content: string;
  emotion: string | null;
  priority: number;
  due_date: string | null;
  estimated_minutes: number | null;
  done: number;
  created_at: string;
}

export interface TaskInput {
  user_id: string;
  content: string;
  emotion?: string;
  priority?: number;
  due_date?: string | null;
  estimated_minutes?: number | null;
}

export async function createTask(db: D1Database, input: TaskInput): Promise<Task> {
  const result = await db
    .prepare(
      `INSERT INTO tasks (user_id, content, emotion, priority, due_date, estimated_minutes)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      input.user_id,
      input.content,
      input.emotion || null,
      input.priority || 3,
      input.due_date || null,
      input.estimated_minutes || null
    )
    .first<Task>();

  return result!;
}

export async function getIncompleteTasks(db: D1Database, userId: string): Promise<Task[]> {
  const { results } = await db
    .prepare('SELECT * FROM tasks WHERE user_id = ? AND done = 0 ORDER BY priority ASC, created_at DESC')
    .bind(userId)
    .all<Task>();

  return results;
}

export async function getAllIncompleteTasks(db: D1Database): Promise<Task[]> {
  const { results } = await db
    .prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY priority ASC, created_at DESC')
    .all<Task>();

  return results;
}

export async function markTaskDone(db: D1Database, taskId: number): Promise<boolean> {
  const result = await db
    .prepare('UPDATE tasks SET done = 1 WHERE id = ?')
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
