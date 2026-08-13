/**
 * Email magic-code accounts — cross-device identity for web, PWA and APK.
 * No Firebase: D1 accounts + KV codes + signed JWT sessions.
 */

import { D1Database } from '@cloudflare/workers-types';
import { getSubscription, setSubscription, type SubscriptionRecord } from './subscription';
import { linkStripeCustomer } from './stripe';

export interface AuthEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  AUTH_JWT_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  AUTH_DEV_EXPOSE_CODE?: string;
  STRIPE_SECRET_KEY?: string;
}

export interface AccountRecord {
  id: string;
  email: string;
  primary_user_id: string;
  created_at: string;
  verified_at: string | null;
}

export interface AuthSession {
  account_id: string;
  user_id: string;
  email: string;
}

let accountsSchemaReady = false;

async function ensureAccountsSchema(db: D1Database): Promise<void> {
  if (accountsSchemaReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        primary_user_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        verified_at TEXT
      )`
    )
    .run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts (primary_user_id)')
    .run();
  accountsSchemaReady = true;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

async function signJwt(env: AuthEnv, payload: Record<string, unknown>): Promise<string> {
  const secret = env.AUTH_JWT_SECRET?.trim() || 'aiva-dev-jwt-secret-change-in-production';
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + 90 * 86400,
    })
  );
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifyJwt(env: AuthEnv, token: string): Promise<AuthSession | null> {
  const secret = env.AUTH_JWT_SECRET?.trim() || 'aiva-dev-jwt-secret-change-in-production';
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  try {
    const sigBytes = Uint8Array.from(base64UrlDecode(signature), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(body)) as AuthSession & { exp?: number };
    if (!payload.account_id || !payload.user_id || !payload.email) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      account_id: payload.account_id,
      user_id: payload.user_id,
      email: payload.email,
    };
  } catch {
    return null;
  }
}

async function sendLoginEmail(env: AuthEnv, email: string, code: string): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (env.AUTH_DEV_EXPOSE_CODE === 'true') return;
    throw new Error('EMAIL_NOT_CONFIGURED');
  }

  const from = env.RESEND_FROM?.trim() || 'KASY <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'KASY — код за вход',
      text: `Вашият код за вход в KASY е: ${code}\n\nКодът е валиден 10 минути. Ако не сте поискали вход, игнорирайте този имейл.`,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(data.message || `Email send failed (${res.status})`);
  }
}

export async function getAccountByEmail(db: D1Database, email: string): Promise<AccountRecord | null> {
  await ensureAccountsSchema(db);
  const row = await db
    .prepare('SELECT * FROM accounts WHERE email = ? COLLATE NOCASE')
    .bind(normalizeEmail(email))
    .first<AccountRecord>();
  return row ?? null;
}

export async function getAccountById(db: D1Database, accountId: string): Promise<AccountRecord | null> {
  await ensureAccountsSchema(db);
  const row = await db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .bind(accountId)
    .first<AccountRecord>();
  return row ?? null;
}

function tierRank(tier: SubscriptionRecord['tier']): number {
  return tier === 'pro' ? 2 : tier === 'plus' ? 1 : 0;
}

async function mergeDeviceIntoAccount(
  env: AuthEnv,
  account: AccountRecord,
  deviceUserId: string
): Promise<void> {
  if (!deviceUserId || deviceUserId === account.primary_user_id) return;

  await env.DB.prepare('UPDATE tasks SET user_id = ? WHERE user_id = ?')
    .bind(account.primary_user_id, deviceUserId)
    .run();

  await env.DB.prepare('UPDATE calendar_connections SET user_id = ? WHERE user_id = ?')
    .bind(account.primary_user_id, deviceUserId)
    .run();

  await env.DB.prepare('UPDATE calendar_calendars SET user_id = ? WHERE user_id = ?')
    .bind(account.primary_user_id, deviceUserId)
    .run();

  await env.DB.prepare('UPDATE calendar_sync_map SET user_id = ? WHERE user_id = ?')
    .bind(account.primary_user_id, deviceUserId)
    .run();

  const deviceSub = await getSubscription(env.SESSIONS, deviceUserId);
  const primarySub = await getSubscription(env.SESSIONS, account.primary_user_id);
  if (tierRank(deviceSub.tier) > tierRank(primarySub.tier)) {
    await setSubscription(env.SESSIONS, account.primary_user_id, {
      ...deviceSub,
      updated_at: new Date().toISOString(),
    });
    if (deviceSub.stripe_customer_id) {
      await linkStripeCustomer(env.SESSIONS, deviceSub.stripe_customer_id, account.primary_user_id);
    }
  }

  const deviceMemory = await env.SESSIONS.get(`memory:${deviceUserId}`);
  const primaryMemory = await env.SESSIONS.get(`memory:${account.primary_user_id}`);
  if (deviceMemory && !primaryMemory) {
    await env.SESSIONS.put(`memory:${account.primary_user_id}`, deviceMemory, { expirationTtl: 365 * 86400 });
  }

  const deviceProfile = await env.SESSIONS.get(`profile:${deviceUserId}`);
  const primaryProfile = await env.SESSIONS.get(`profile:${account.primary_user_id}`);
  if (deviceProfile && !primaryProfile) {
    await env.SESSIONS.put(`profile:${account.primary_user_id}`, deviceProfile, { expirationTtl: 365 * 86400 });
  }
}

export async function requestLoginCode(
  env: AuthEnv,
  email: string
): Promise<{ success: true; dev_code?: string }> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error('INVALID_EMAIL');
  }

  const rateKey = `auth:rate:${normalized}:${new Date().toISOString().slice(0, 13)}`;
  const attempts = parseInt((await env.SESSIONS.get(rateKey)) || '0', 10);
  if (attempts >= 5) {
    throw new Error('RATE_LIMIT');
  }
  await env.SESSIONS.put(rateKey, String(attempts + 1), { expirationTtl: 3600 });

  const code = generateCode();
  await env.SESSIONS.put(
    `auth:code:${normalized}`,
    JSON.stringify({ code, created_at: Date.now() }),
    { expirationTtl: 600 }
  );

  try {
    await sendLoginEmail(env, normalized, code);
  } catch (e) {
    if ((e as Error).message === 'EMAIL_NOT_CONFIGURED' && env.AUTH_DEV_EXPOSE_CODE === 'true') {
      return { success: true, dev_code: code };
    }
    throw e;
  }

  if (env.AUTH_DEV_EXPOSE_CODE === 'true') {
    return { success: true, dev_code: code };
  }

  return { success: true };
}

export async function verifyLoginCode(
  env: AuthEnv,
  email: string,
  code: string,
  deviceUserId: string
): Promise<{ token: string; user_id: string; email: string; account_id: string }> {
  const normalized = normalizeEmail(email);
  const trimmedCode = String(code || '').trim();
  if (!isValidEmail(normalized) || !/^\d{6}$/.test(trimmedCode)) {
    throw new Error('INVALID_INPUT');
  }

  const raw = await env.SESSIONS.get(`auth:code:${normalized}`);
  if (!raw) throw new Error('CODE_EXPIRED');

  const stored = JSON.parse(raw) as { code: string };
  if (stored.code !== trimmedCode) throw new Error('CODE_INVALID');

  await env.SESSIONS.delete(`auth:code:${normalized}`);

  await ensureAccountsSchema(env.DB);
  let account = await getAccountByEmail(env.DB, normalized);

  if (!account) {
    const accountId = `acc_${crypto.randomUUID()}`;
    const primaryUserId = deviceUserId?.trim() || `user_${crypto.randomUUID()}`;
    await env.DB
      .prepare(
        `INSERT INTO accounts (id, email, primary_user_id, verified_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .bind(accountId, normalized, primaryUserId)
      .run();
    account = {
      id: accountId,
      email: normalized,
      primary_user_id: primaryUserId,
      created_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
    };
  } else {
    await env.DB
      .prepare(`UPDATE accounts SET verified_at = datetime('now') WHERE id = ?`)
      .bind(account.id)
      .run();
  }

  if (deviceUserId) {
    await mergeDeviceIntoAccount(env, account, deviceUserId);
  }

  const token = await signJwt(env, {
    account_id: account.id,
    user_id: account.primary_user_id,
    email: account.email,
  });

  return {
    token,
    user_id: account.primary_user_id,
    email: account.email,
    account_id: account.id,
  };
}

async function stripeGet(env: AuthEnv, path: string): Promise<{ data?: Array<{ id: string }> }> {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return { data: [] };
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return { data: [] };
  return res.json();
}

export async function restoreSubscriptionByEmail(
  env: AuthEnv,
  email: string,
  targetUserId: string
): Promise<{ restored: boolean; tier?: string }> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized) || !targetUserId?.trim()) {
    throw new Error('INVALID_INPUT');
  }

  const customers = await stripeGet(
    env,
    `/customers?email=${encodeURIComponent(normalized)}&limit=5`
  );

  let sourceUserId: string | null = null;
  let bestSub: SubscriptionRecord | null = null;

  for (const customer of customers.data || []) {
    const mappedUserId = await env.SESSIONS.get(`stripe:cust:${customer.id}`);
    if (!mappedUserId) continue;
    const sub = await getSubscription(env.SESSIONS, mappedUserId);
    if (!bestSub || tierRank(sub.tier) > tierRank(bestSub.tier)) {
      bestSub = sub;
      sourceUserId = mappedUserId;
    }
  }

  if (!bestSub || !sourceUserId || tierRank(bestSub.tier) < 1) {
    return { restored: false };
  }

  await setSubscription(env.SESSIONS, targetUserId, {
    ...bestSub,
    updated_at: new Date().toISOString(),
  });

  if (bestSub.stripe_customer_id) {
    await linkStripeCustomer(env.SESSIONS, bestSub.stripe_customer_id, targetUserId);
  }

  return { restored: true, tier: bestSub.tier };
}
