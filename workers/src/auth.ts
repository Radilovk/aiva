import type { Context, Next } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';

export interface AuthEnv {
  DB: D1Database;
}

export interface AuthVariables {
  userId: string;
}

let userSchemaReady = false;

async function ensureUserSchema(db: D1Database): Promise<void> {
  if (userSchemaReady) return;
  const { results } = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
  const cols = new Set(results.map((r) => r.name));
  if (!cols.has('ics_feed_token')) {
    await db.prepare('ALTER TABLE users ADD COLUMN ics_feed_token TEXT').run();
  }
  userSchemaReady = true;
}

export function newIcsFeedToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export async function getUserIdByAppToken(db: D1Database, appToken: string): Promise<string | null> {
  await ensureUserSchema(db);
  const row = await db
    .prepare('SELECT id FROM users WHERE app_token = ? LIMIT 1')
    .bind(appToken)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function getUserIdByIcsToken(db: D1Database, feedToken: string): Promise<string | null> {
  await ensureUserSchema(db);
  const row = await db
    .prepare('SELECT id FROM users WHERE ics_feed_token = ? LIMIT 1')
    .bind(feedToken)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function registerUserAuth(
  db: D1Database,
  userId: string,
  appToken: string
): Promise<{ ics_feed_token: string }> {
  await ensureUserSchema(db);
  const existing = await db
    .prepare('SELECT ics_feed_token FROM users WHERE id = ?')
    .bind(userId)
    .first<{ ics_feed_token: string | null }>();

  const icsToken = existing?.ics_feed_token || newIcsFeedToken();

  await db
    .prepare(
      `INSERT INTO users (id, app_token, ics_feed_token) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         app_token = excluded.app_token,
         ics_feed_token = COALESCE(users.ics_feed_token, excluded.ics_feed_token)`
    )
    .bind(userId, appToken, icsToken)
    .run();

  const row = await db
    .prepare('SELECT ics_feed_token FROM users WHERE id = ?')
    .bind(userId)
    .first<{ ics_feed_token: string }>();

  return { ics_feed_token: row?.ics_feed_token || icsToken };
}

function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function isPublicApiPath(pathname: string, method: string): boolean {
  if (pathname === '/api/users/register' && method === 'POST') return true;
  if (pathname === '/api/stripe/webhook' && method === 'POST') return true;
  if (pathname === '/api/calendar.ics' && method === 'GET') return true;
  if (pathname === '/api/calendar/google-credential-check' && method === 'GET') return true;
  if (pathname === '/api/brand-config' && method === 'GET') return true;
  return false;
}

export function authMiddleware() {
  return async (c: Context<{ Bindings: AuthEnv; Variables: AuthVariables }>, next: Next) => {
    const url = new URL(c.req.url);
    if (!url.pathname.startsWith('/api/')) return next();
    if (isPublicApiPath(url.pathname, c.req.method)) return next();

    const token = parseBearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    const userId = await getUserIdByAppToken(c.env.DB, token);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    c.set('userId', userId);
    await next();
  };
}

export function authUserId(c: Context): string {
  return c.get('userId') as string;
}

export function forbidUnlessSelf(c: Context, requested?: string | null): Response | null {
  if (requested && requested !== authUserId(c)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return null;
}
