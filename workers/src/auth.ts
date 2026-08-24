/**
 * Идентичност и автентикация.
 *
 * Досега `user_id` се генерираше от клиента и не се проверяваше никъде — всеки можеше да
 * чете и променя чужди задачи, познавайки едно число. Тук идентичността се издава от
 * сървъра: при първо стартиране клиентът получава `user_id` + таен `app_token`, а всяка
 * следваща заявка го носи в `Authorization: Bearer <token>`.
 *
 * Потребителят не вижда нищо от това — няма екран за вход. Акаунт (Google Sign-In) се
 * появява по-късно и само при абониране, за да преживява абонаментът преинсталация.
 *
 * @see docs/LAUNCH-PLAN.md — Фаза 0
 */

import type { Context, MiddlewareHandler, Next } from 'hono';

export interface AuthEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  /** 'false' спира осиновяването на стари клиентски user_id — включи го след миграционния прозорец. */
  ALLOW_LEGACY_CLAIM?: string;
}

export interface Identity {
  user_id: string;
  app_token: string;
}

/** Токените се кешират в KV за час, за да не удря D1 всяка заявка. */
const TOKEN_CACHE_TTL_SECONDS = 3600;

let usersSchemaReady = false;

async function ensureUsersSchema(db: D1Database): Promise<void> {
  if (usersSchemaReady) return;

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
         id TEXT PRIMARY KEY,
         app_token TEXT,
         created_at TEXT DEFAULT (datetime('now'))
       )`
    )
    .run();

  // Всяка заявка резолвва потребител по токен — без индекс това е пълно сканиране.
  // Нарочно не е UNIQUE: върху заварени данни създаването би се провалило, а провал тук
  // сваля цялото API. Уникалността и без това я гарантират 256-те бита ентропия.
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_users_app_token ON users (app_token)')
    .run();

  usersSchemaReady = true;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Токените не се пазят в KV в чист вид — кешът се ключова по хеш. */
async function cacheKey(token: string): Promise<string> {
  return `auth:${await sha256Hex(token)}`;
}

export function isLegacyClaimAllowed(env: AuthEnv): boolean {
  return env.ALLOW_LEGACY_CLAIM !== 'false';
}

export type IssueResult =
  | { ok: true; identity: Identity; claimed: boolean }
  | { ok: false; reason: 'taken' | 'claim_disabled' };

/**
 * Издава нова идентичност.
 *
 * `claimUserId` покрива миграцията: съществуващите потребители имат `user_id` в localStorage
 * и задачи в D1, но никога не са били регистрирани. Осиновяването на непретендиран стар ID
 * запазва задачите им. Старите ID-та са `crypto.randomUUID()` (122 бита), тоест непознаваеми,
 * а вече претендиран ID не може да бъде превзет.
 */
export async function issueIdentity(
  env: AuthEnv,
  claimUserId?: string
): Promise<IssueResult> {
  await ensureUsersSchema(env.DB);

  const appToken = randomHex(32);

  if (claimUserId) {
    if (!isLegacyClaimAllowed(env)) {
      return { ok: false, reason: 'claim_disabled' };
    }

    // Успява само ако редът още не съществува — вече регистриран ID не може да се превземе.
    const claimed = await env.DB
      .prepare('INSERT OR IGNORE INTO users (id, app_token) VALUES (?, ?)')
      .bind(claimUserId, appToken)
      .run();

    if (!claimed.meta.changes) {
      return { ok: false, reason: 'taken' };
    }

    return { ok: true, identity: { user_id: claimUserId, app_token: appToken }, claimed: true };
  }

  const userId = `user_${crypto.randomUUID()}`;
  await env.DB
    .prepare('INSERT INTO users (id, app_token) VALUES (?, ?)')
    .bind(userId, appToken)
    .run();

  return { ok: true, identity: { user_id: userId, app_token: appToken }, claimed: false };
}

/** Връща `user_id` за валиден токен, иначе null. */
export async function resolveUserByToken(env: AuthEnv, token: string): Promise<string | null> {
  if (!token) return null;

  const key = await cacheKey(token);
  const cached = await env.SESSIONS.get(key);
  if (cached) return cached;

  await ensureUsersSchema(env.DB);

  const row = await env.DB
    .prepare('SELECT id FROM users WHERE app_token = ?')
    .bind(token)
    .first<{ id: string }>();

  if (!row) return null;

  await env.SESSIONS.put(key, row.id, { expirationTtl: TOKEN_CACHE_TTL_SECONDS });
  return row.id;
}

export function bearerToken(c: Context): string | null {
  const header = c.req.header('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export interface AuthVariables {
  userId: string;
}

/**
 * Изисква валиден Bearer токен и слага верифицирания `user_id` в контекста.
 * Маршрутите четат `c.get('userId')` — клиентът вече не подава `user_id` изобщо.
 */
export function requireAuth<E extends { Bindings: AuthEnv; Variables: AuthVariables }>(): MiddlewareHandler<E> {
  return async (c, next: Next) => {
    const token = bearerToken(c as unknown as Context);

    if (!token) {
      return c.json({ error: 'Липсва Authorization токен.', code: 'AUTH_REQUIRED' }, 401);
    }

    const userId = await resolveUserByToken(c.env, token);
    if (!userId) {
      return c.json({ error: 'Невалиден или изтекъл токен.', code: 'AUTH_INVALID' }, 401);
    }

    c.set('userId', userId as never);
    await next();
  };
}
