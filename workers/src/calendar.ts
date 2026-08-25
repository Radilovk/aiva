import { D1Database, KVNamespace } from '@cloudflare/workers-types';
import type { Task } from './tasks';

export type CalendarProvider = 'google' | 'microsoft' | 'apple';

export interface CalendarEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_REDIRECT_URI?: string;
  MICROSOFT_TENANT_ID?: string;
}

interface CalendarConnection {
  user_id: string;
  provider: CalendarProvider;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
  provider_user_id: string | null;
  connected_at: string;
  updated_at: string;
}

interface ProviderConfig {
  provider: CalendarProvider;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
}

interface ProviderStatus {
  provider: CalendarProvider;
  configured: boolean;
  connected: boolean;
  selectedCalendarId: string | null;
  selectedCalendarName: string | null;
  connectedAt: string | null;
}

interface OAuthStatePayload {
  userId: string;
  provider: CalendarProvider;
  redirectUri: string;
}

let calendarSchemaReady = false;

async function ensureCalendarSchema(db: D1Database): Promise<void> {
  if (calendarSchemaReady) return;

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS calendar_connections (
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
       )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS calendar_calendars (
         user_id TEXT NOT NULL,
         provider TEXT NOT NULL,
         external_calendar_id TEXT NOT NULL,
         name TEXT NOT NULL,
         timezone TEXT,
         is_primary INTEGER DEFAULT 0,
         is_selected INTEGER DEFAULT 0,
         updated_at TEXT DEFAULT (datetime('now')),
         PRIMARY KEY (user_id, provider, external_calendar_id)
       )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS calendar_sync_map (
         task_id INTEGER NOT NULL,
         user_id TEXT NOT NULL,
         provider TEXT NOT NULL,
         external_calendar_id TEXT NOT NULL,
         external_event_id TEXT NOT NULL,
         synced_at TEXT DEFAULT (datetime('now')),
         PRIMARY KEY (task_id, user_id, provider)
       )`
    )
    .run();

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_calendar_conn_user ON calendar_connections (user_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_calendar_sync_user ON calendar_sync_map (user_id, provider)').run();

  calendarSchemaReady = true;
}

function providerConfig(env: CalendarEnv, provider: CalendarProvider, origin: string): ProviderConfig | null {
  if (provider === 'google') {
    const clientId = env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    return {
      provider,
      clientId,
      clientSecret,
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'openid',
        'profile',
        'email',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      redirectUri: env.GOOGLE_REDIRECT_URI || `${origin}/settings.html`,
    };
  }

  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) return null;
  const tenant = env.MICROSOFT_TENANT_ID || 'common';
  return {
    provider,
    clientId: env.MICROSOFT_CLIENT_ID.trim(),
    clientSecret: env.MICROSOFT_CLIENT_SECRET.trim(),
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: ['offline_access', 'User.Read', 'Calendars.ReadWrite'],
    redirectUri: env.MICROSOFT_REDIRECT_URI || `${origin}/settings.html`,
  };
}

function oauthStateKey(state: string): string {
  return `calendar_oauth_state:${state}`;
}

function randomState(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

async function storeOAuthState(env: CalendarEnv, payload: OAuthStatePayload): Promise<string> {
  const state = randomState();
  await env.SESSIONS.put(oauthStateKey(state), JSON.stringify(payload), { expirationTtl: 600 });
  return state;
}

async function consumeOAuthState(env: CalendarEnv, state: string): Promise<OAuthStatePayload | null> {
  const key = oauthStateKey(state);
  const raw = await env.SESSIONS.get(key);
  if (!raw) return null;
  await env.SESSIONS.delete(key);

  try {
    return JSON.parse(raw) as OAuthStatePayload;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiryFromNow(seconds: number): string {
  return new Date(Date.now() + Math.max(60, seconds) * 1000).toISOString();
}

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function saveConnection(
  db: D1Database,
  userId: string,
  provider: CalendarProvider,
  accessToken: string,
  refreshToken: string,
  expiresAt: string,
  scope?: string,
  providerUserId?: string
): Promise<void> {
  await ensureCalendarSchema(db);

  await db
    .prepare(
      `INSERT INTO calendar_connections (
         user_id, provider, access_token, refresh_token, expires_at, scope, provider_user_id, connected_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id, provider) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         provider_user_id = excluded.provider_user_id,
         updated_at = datetime('now')`
    )
    .bind(userId, provider, accessToken, refreshToken, expiresAt, scope || null, providerUserId || null)
    .run();
}

async function getConnection(db: D1Database, userId: string, provider: CalendarProvider): Promise<CalendarConnection | null> {
  await ensureCalendarSchema(db);
  const row = await db
    .prepare('SELECT * FROM calendar_connections WHERE user_id = ? AND provider = ?')
    .bind(userId, provider)
    .first<CalendarConnection>();
  return row ?? null;
}

async function refreshAccessToken(
  env: CalendarEnv,
  connection: CalendarConnection,
  origin: string
): Promise<CalendarConnection | null> {
  const cfg = providerConfig(env, connection.provider, origin);
  if (!cfg) return null;

  const payload = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  if (connection.provider === 'microsoft') {
    payload.set('scope', cfg.scopes.join(' '));
  }

  const resp = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error('Calendar refresh token failed:', connection.provider, err);
    return null;
  }

  const token = parseJsonSafe<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(await resp.text());

  if (!token?.access_token || !token.expires_in) return null;

  const next = {
    ...connection,
    access_token: token.access_token,
    refresh_token: token.refresh_token || connection.refresh_token,
    expires_at: expiryFromNow(token.expires_in),
    scope: token.scope || connection.scope,
  };

  await saveConnection(
    env.DB,
    next.user_id,
    next.provider,
    next.access_token,
    next.refresh_token,
    next.expires_at,
    next.scope || undefined,
    next.provider_user_id || undefined
  );

  return next;
}

async function getValidConnection(
  env: CalendarEnv,
  userId: string,
  provider: CalendarProvider,
  origin: string
): Promise<CalendarConnection | null> {
  const conn = await getConnection(env.DB, userId, provider);
  if (!conn) return null;

  if (provider === 'apple') return conn;

  const expires = new Date(conn.expires_at).getTime();
  if (Number.isFinite(expires) && expires - Date.now() > 60_000) {
    return conn;
  }

  return refreshAccessToken(env, conn, origin);
}

async function fetchGoogleCalendars(accessToken: string): Promise<Array<{ id: string; name: string; primary: boolean; timezone?: string }>> {
  const resp = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: 'B' + 'earer ' + accessToken },
  });
  if (resp.ok) {
    const data = parseJsonSafe<{ items?: Array<{ id: string; summary: string; primary?: boolean; timeZone?: string }> }>(await resp.text());
    return (data?.items || []).map((c) => ({
      id: c.id,
      name: c.summary,
      primary: !!c.primary,
      timezone: c.timeZone,
    }));
  }

  // calendar.events cannot call calendarList — fall back to the primary calendar alias.
  if (resp.status === 403 || resp.status === 401) {
    return [{ id: 'primary', name: 'Primary calendar', primary: true }];
  }

  const err = await resp.text();
  throw new Error(`Google calendar list failed: ${err}`);
}

async function fetchMicrosoftCalendars(accessToken: string): Promise<Array<{ id: string; name: string; primary: boolean; timezone?: string }>> {
  const resp = await fetch('https://graph.microsoft.com/v1.0/me/calendars', {
    headers: { Authorization: 'B' + 'earer ' + accessToken },
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Microsoft calendar list failed: ${err}`);
  }

  const data = parseJsonSafe<{ value?: Array<{ id: string; name: string; isDefaultCalendar?: boolean }> }>(await resp.text());
  return (data?.value || []).map((c) => ({
    id: c.id,
    name: c.name,
    primary: !!c.isDefaultCalendar,
  }));
}

async function upsertCalendars(
  db: D1Database,
  userId: string,
  provider: CalendarProvider,
  calendars: Array<{ id: string; name: string; primary: boolean; timezone?: string }>
): Promise<void> {
  await ensureCalendarSchema(db);

  const selected = await db
    .prepare('SELECT external_calendar_id FROM calendar_calendars WHERE user_id = ? AND provider = ? AND is_selected = 1 LIMIT 1')
    .bind(userId, provider)
    .first<{ external_calendar_id: string }>();

  await db.prepare('DELETE FROM calendar_calendars WHERE user_id = ? AND provider = ?').bind(userId, provider).run();

  const fallbackSelected = selected?.external_calendar_id || calendars.find((c) => c.primary)?.id || calendars[0]?.id || null;

  for (const cal of calendars) {
    await db
      .prepare(
        `INSERT INTO calendar_calendars (
           user_id, provider, external_calendar_id, name, timezone, is_primary, is_selected, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(
        userId,
        provider,
        cal.id,
        cal.name,
        cal.timezone || null,
        cal.primary ? 1 : 0,
        fallbackSelected === cal.id ? 1 : 0
      )
      .run();
  }
}

async function syncCalendarsForConnection(env: CalendarEnv, userId: string, provider: CalendarProvider, origin: string): Promise<void> {
  const conn = await getValidConnection(env, userId, provider, origin);
  if (!conn) return;

  let calendars;
  if (provider === 'google') {
    calendars = await fetchGoogleCalendars(conn.access_token);
  } else if (provider === 'microsoft') {
    calendars = await fetchMicrosoftCalendars(conn.access_token);
  } else {
    calendars = await fetchAppleCalendars(conn.provider_user_id!, conn.access_token);
  }

  await upsertCalendars(env.DB, userId, provider, calendars);
}

async function getSelectedCalendar(
  db: D1Database,
  userId: string,
  provider: CalendarProvider
): Promise<{ id: string; name: string } | null> {
  await ensureCalendarSchema(db);

  const selected = await db
    .prepare(
      `SELECT external_calendar_id, name
       FROM calendar_calendars
       WHERE user_id = ? AND provider = ? AND is_selected = 1
       LIMIT 1`
    )
    .bind(userId, provider)
    .first<{ external_calendar_id: string; name: string }>();

  if (selected) {
    return { id: selected.external_calendar_id, name: selected.name };
  }

  const fallback = await db
    .prepare(
      `SELECT external_calendar_id, name
       FROM calendar_calendars
       WHERE user_id = ? AND provider = ?
       ORDER BY is_primary DESC, name ASC
       LIMIT 1`
    )
    .bind(userId, provider)
    .first<{ external_calendar_id: string; name: string }>();

  if (!fallback) return null;

  await db
    .prepare(
      `UPDATE calendar_calendars
       SET is_selected = CASE WHEN external_calendar_id = ? THEN 1 ELSE 0 END,
           updated_at = datetime('now')
       WHERE user_id = ? AND provider = ?`
    )
    .bind(fallback.external_calendar_id, userId, provider)
    .run();

  return { id: fallback.external_calendar_id, name: fallback.name };
}

function taskDateRange(task: Task): {
  startDateTime: string;
  endDateTime: string;
  isAllDay: boolean;
} | null {
  if (!task.due_date) return null;

  if (!task.due_time) {
    const start = `${task.due_date}T09:00:00`;
    const minutes = task.estimated_minutes || 30;
    const startDate = new Date(`${task.due_date}T09:00:00`);
    const endDate = new Date(startDate.getTime() + minutes * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const end = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`;
    return { startDateTime: start, endDateTime: end, isAllDay: false };
  }

  const start = `${task.due_date}T${task.due_time}:00`;
  const duration = task.estimated_minutes || 30;
  const startDate = new Date(`${task.due_date}T${task.due_time}:00`);
  const endDate = new Date(startDate.getTime() + duration * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const end = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`;

  return { startDateTime: start, endDateTime: end, isAllDay: false };
}

function buildGoogleEvent(task: Task): Record<string, unknown> | null {
  const range = taskDateRange(task);
  if (!range) return null;

  return {
    summary: task.content,
    description: task.notes || undefined,
    location: task.location || undefined,
    start: { dateTime: range.startDateTime, timeZone: 'Europe/Sofia' },
    end: { dateTime: range.endDateTime, timeZone: 'Europe/Sofia' },
    reminders: { useDefault: true },
  };
}

function escapeICSText(value: string | null | undefined): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildAppleEventICS(task: Task): string | null {
  const range = taskDateRange(task);
  if (!range) return null;

  const toICSStamp = (iso: string) => iso.replace(/[-:]/g, '').split('.')[0] + 'Z';

  const dtStart = toICSStamp(range.startDateTime);
  const dtEnd = toICSStamp(range.endDateTime);
  const now = toICSStamp(new Date().toISOString());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AIVA//Apple CalDAV//BG',
    'BEGIN:VEVENT',
    `UID:aiva-task-${task.id}`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=Europe/Sofia:${dtStart.replace('Z', '')}`,
    `DTEND;TZID=Europe/Sofia:${dtEnd.replace('Z', '')}`,
    `SUMMARY:${escapeICSText(task.content)}`,
    `DESCRIPTION:${escapeICSText(task.notes)}`,
    `LOCATION:${escapeICSText(task.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

function buildMicrosoftEvent(task: Task): Record<string, unknown> | null {
  const range = taskDateRange(task);
  if (!range) return null;

  return {
    subject: task.content,
    body: {
      contentType: 'text',
      content: task.notes || '',
    },
    location: task.location ? { displayName: task.location } : undefined,
    start: { dateTime: range.startDateTime, timeZone: 'FLE Standard Time' },
    end: { dateTime: range.endDateTime, timeZone: 'FLE Standard Time' },
    isReminderOn: true,
    reminderMinutesBeforeStart: 15,
  };
}

async function upsertSyncMap(
  db: D1Database,
  taskId: number,
  userId: string,
  provider: CalendarProvider,
  calendarId: string,
  eventId: string
): Promise<void> {
  await ensureCalendarSchema(db);
  await db
    .prepare(
      `INSERT INTO calendar_sync_map (task_id, user_id, provider, external_calendar_id, external_event_id, synced_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(task_id, user_id, provider) DO UPDATE SET
         external_calendar_id = excluded.external_calendar_id,
         external_event_id = excluded.external_event_id,
         synced_at = datetime('now')`
    )
    .bind(taskId, userId, provider, calendarId, eventId)
    .run();
}

async function readSyncMap(
  db: D1Database,
  taskId: number,
  userId: string,
  provider: CalendarProvider
): Promise<{ external_event_id: string; external_calendar_id: string } | null> {
  await ensureCalendarSchema(db);
  const row = await db
    .prepare(
      `SELECT external_event_id, external_calendar_id
       FROM calendar_sync_map
       WHERE task_id = ? AND user_id = ? AND provider = ?`
    )
    .bind(taskId, userId, provider)
    .first<{ external_event_id: string; external_calendar_id: string }>();
  return row ?? null;
}

async function removeSyncMap(db: D1Database, taskId: number, userId: string, provider: CalendarProvider): Promise<void> {
  await ensureCalendarSchema(db);
  await db
    .prepare('DELETE FROM calendar_sync_map WHERE task_id = ? AND user_id = ? AND provider = ?')
    .bind(taskId, userId, provider)
    .run();
}

async function providerApi(
  env: CalendarEnv,
  userId: string,
  provider: CalendarProvider,
  origin: string,
  path: string,
  init: RequestInit
): Promise<Response | null> {
  const conn = await getValidConnection(env, userId, provider, origin);
  if (!conn) return null;

  if (provider === 'apple') {
    const baseUrl = path.startsWith('http') ? '' : 'https://caldav.icloud.com';
    const auth = btoa(`${conn.provider_user_id}:${conn.access_token}`);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${auth}`,
        ...(init.headers || {}),
      },
    });
  }

  const url = provider === 'google'
    ? `https://www.googleapis.com${path}`
    : `https://graph.microsoft.com${path}`;

  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'B' + 'earer ' + conn.access_token,
      ...(init.headers || {}),
    },
  });
}

async function listConnectedProviders(db: D1Database, userId: string): Promise<CalendarProvider[]> {
  await ensureCalendarSchema(db);
  const { results } = await db
    .prepare('SELECT provider FROM calendar_connections WHERE user_id = ?')
    .bind(userId)
    .all<{ provider: CalendarProvider }>();
  return results.map((r) => r.provider);
}

export async function getProviderStatuses(env: CalendarEnv, userId: string): Promise<ProviderStatus[]> {
  await ensureCalendarSchema(env.DB);

  const configuredGoogle = !!providerConfig(env, 'google', 'https://localhost');
  const configuredMicrosoft = !!providerConfig(env, 'microsoft', 'https://localhost');

  const { results } = await env.DB
    .prepare(
      `SELECT c.provider, c.connected_at, cal.external_calendar_id, cal.name
       FROM calendar_connections c
       LEFT JOIN calendar_calendars cal
         ON c.user_id = cal.user_id AND c.provider = cal.provider AND cal.is_selected = 1
       WHERE c.user_id = ?`
    )
    .bind(userId)
    .all<{ provider: CalendarProvider; connected_at: string; external_calendar_id: string | null; name: string | null }>();

  const map = new Map(results.map((row) => [row.provider, row]));

  return [
    {
      provider: 'google',
      configured: configuredGoogle,
      connected: map.has('google'),
      selectedCalendarId: map.get('google')?.external_calendar_id || null,
      selectedCalendarName: map.get('google')?.name || null,
      connectedAt: map.get('google')?.connected_at || null,
    },
    {
      provider: 'microsoft',
      configured: configuredMicrosoft,
      connected: map.has('microsoft'),
      selectedCalendarId: map.get('microsoft')?.external_calendar_id || null,
      selectedCalendarName: map.get('microsoft')?.name || null,
      connectedAt: map.get('microsoft')?.connected_at || null,
    },
    {
      provider: 'apple',
      configured: true, // Apple integration is always "configured" via CalDAV
      connected: map.has('apple'),
      selectedCalendarId: map.get('apple')?.external_calendar_id || null,
      selectedCalendarName: map.get('apple')?.name || null,
      connectedAt: map.get('apple')?.connected_at || null,
    },
  ];
}

function isAllowedOAuthRedirect(origin: string, redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    const base = origin.replace(/\/$/, '');
    const allowed = new Set([
      `${base}/settings.html`,
      `${base}/settings`,
    ]);
    return allowed.has(`${url.origin}${url.pathname}`);
  } catch {
    return false;
  }
}

export async function startOAuthConnect(
  env: CalendarEnv,
  provider: CalendarProvider,
  userId: string,
  origin: string,
  redirectUri?: string
): Promise<{ url: string; state: string }> {
  const cfg = providerConfig(env, provider, origin);
  if (!cfg) {
    throw new Error(`${provider} не е конфигуриран на сървъра`);
  }

  const requested = redirectUri || cfg.redirectUri;
  const finalRedirect = isAllowedOAuthRedirect(origin, requested)
    ? requested
    : cfg.redirectUri;
  const state = await storeOAuthState(env, { userId, provider, redirectUri: finalRedirect });

  const query = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: finalRedirect,
    scope: cfg.scopes.join(' '),
    state,
    access_type: 'offline',
    hl: 'en',
  });

  if (provider === 'microsoft') {
    query.delete('access_type');
    query.delete('prompt');
    query.set('response_mode', 'query');
  }

  return { url: `${cfg.authUrl}?${query.toString()}`, state };
}

export async function completeOAuthConnect(
  env: CalendarEnv,
  params: {
    userId: string;
    provider: CalendarProvider;
    code: string;
    state: string;
    origin: string;
    redirectUri?: string;
  }
): Promise<void> {
  const statePayload = await consumeOAuthState(env, params.state);
  if (!statePayload || statePayload.userId !== params.userId || statePayload.provider !== params.provider) {
    throw new Error('Невалиден OAuth state');
  }

  const cfg = providerConfig(env, params.provider, params.origin);
  if (!cfg) {
    throw new Error(`${params.provider} не е конфигуриран`);
  }

  const redirectUri = params.redirectUri || statePayload.redirectUri || cfg.redirectUri;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code: params.code,
    redirect_uri: redirectUri,
  });

  if (params.provider === 'microsoft') {
    body.set('scope', cfg.scopes.join(' '));
  }

  const tokenResp = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.text();
    throw new Error(`OAuth token error: ${err}`);
  }

  const token = parseJsonSafe<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(await tokenResp.text());

  if (!token?.access_token || !token?.refresh_token || !token?.expires_in) {
    throw new Error('Липсва валиден token от провайдъра');
  }

  await saveConnection(
    env.DB,
    params.userId,
    params.provider,
    token.access_token,
    token.refresh_token,
    expiryFromNow(token.expires_in),
    token.scope
  );

  await syncCalendarsForConnection(env, params.userId, params.provider, params.origin);
}

export async function listProviderCalendars(
  env: CalendarEnv,
  userId: string,
  provider: CalendarProvider,
  origin: string
): Promise<Array<{ id: string; name: string; selected: boolean; primary: boolean }>> {
  await syncCalendarsForConnection(env, userId, provider, origin);
  await ensureCalendarSchema(env.DB);

  const { results } = await env.DB
    .prepare(
      `SELECT external_calendar_id, name, is_selected, is_primary
       FROM calendar_calendars
       WHERE user_id = ? AND provider = ?
       ORDER BY is_selected DESC, is_primary DESC, name ASC`
    )
    .bind(userId, provider)
    .all<{ external_calendar_id: string; name: string; is_selected: number; is_primary: number }>();

  return results.map((r) => ({
    id: r.external_calendar_id,
    name: r.name,
    selected: !!r.is_selected,
    primary: !!r.is_primary,
  }));
}

export async function setSelectedCalendar(
  db: D1Database,
  userId: string,
  provider: CalendarProvider,
  calendarId: string
): Promise<void> {
  await ensureCalendarSchema(db);

  await db
    .prepare(
      `UPDATE calendar_calendars
       SET is_selected = CASE WHEN external_calendar_id = ? THEN 1 ELSE 0 END,
           updated_at = datetime('now')
       WHERE user_id = ? AND provider = ?`
    )
    .bind(calendarId, userId, provider)
    .run();
}

export async function disconnectProvider(db: D1Database, userId: string, provider: CalendarProvider): Promise<void> {
  await ensureCalendarSchema(db);

  await db.prepare('DELETE FROM calendar_connections WHERE user_id = ? AND provider = ?').bind(userId, provider).run();
  await db.prepare('DELETE FROM calendar_calendars WHERE user_id = ? AND provider = ?').bind(userId, provider).run();
  await db.prepare('DELETE FROM calendar_sync_map WHERE user_id = ? AND provider = ?').bind(userId, provider).run();
}

export async function syncTaskToCloudCalendars(env: CalendarEnv, task: Task, origin: string): Promise<void> {
  if (!task?.id || !task.user_id) return;

  const providers = await listConnectedProviders(env.DB, task.user_id);
  if (!providers.length) return;

  for (const provider of providers) {
    try {
      if (!task.due_date || task.done) {
        await removeTaskFromCloudCalendar(env, task.user_id, task.id, provider, origin);
        continue;
      }

      const selected = await getSelectedCalendar(env.DB, task.user_id, provider);
      if (!selected) continue;

      const existing = await readSyncMap(env.DB, task.id, task.user_id, provider);

      if (provider === 'apple') {
        const ics = buildAppleEventICS(task);
        if (!ics) continue;

        const eventPath = existing?.external_event_id || `${selected.id}aiva-task-${task.id}.ics`;
        const resp = await providerApi(env, task.user_id, 'apple', origin, eventPath, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
          body: ics,
        });

        if (resp?.ok) {
          if (!existing) {
            await upsertSyncMap(env.DB, task.id, task.user_id, 'apple', selected.id, eventPath);
          }
        } else {
          console.error('Apple CalDAV sync failed:', await resp?.text());
        }
        continue;
      }

      const payload = provider === 'google' ? buildGoogleEvent(task) : buildMicrosoftEvent(task);
      if (!payload) continue;

      if (provider === 'google') {
        if (!existing) {
          const resp = await providerApi(
            env,
            task.user_id,
            provider,
            origin,
            `/calendar/v3/calendars/${encodeURIComponent(selected.id)}/events`,
            { method: 'POST', body: JSON.stringify(payload) }
          );
          if (!resp?.ok) {
            console.error('Google event create failed:', await resp?.text());
            continue;
          }
          const data = parseJsonSafe<{ id?: string }>(await resp.text());
          if (data?.id) await upsertSyncMap(env.DB, task.id, task.user_id, provider, selected.id, data.id);
        } else {
          const resp = await providerApi(
            env,
            task.user_id,
            provider,
            origin,
            `/calendar/v3/calendars/${encodeURIComponent(existing.external_calendar_id)}/events/${encodeURIComponent(existing.external_event_id)}`,
            { method: 'PATCH', body: JSON.stringify(payload) }
          );
          if (!resp?.ok) {
            console.error('Google event update failed:', await resp?.text());
          }
        }
      } else {
        if (!existing) {
          const resp = await providerApi(
            env,
            task.user_id,
            provider,
            origin,
            `/v1.0/me/calendars/${encodeURIComponent(selected.id)}/events`,
            { method: 'POST', body: JSON.stringify(payload) }
          );
          if (!resp?.ok) {
            console.error('Microsoft event create failed:', await resp?.text());
            continue;
          }
          const data = parseJsonSafe<{ id?: string }>(await resp.text());
          if (data?.id) await upsertSyncMap(env.DB, task.id, task.user_id, provider, selected.id, data.id);
        } else {
          const resp = await providerApi(
            env,
            task.user_id,
            provider,
            origin,
            `/v1.0/me/calendars/${encodeURIComponent(existing.external_calendar_id)}/events/${encodeURIComponent(existing.external_event_id)}`,
            { method: 'PATCH', body: JSON.stringify(payload) }
          );
          if (!resp?.ok) {
            console.error('Microsoft event update failed:', await resp?.text());
          }
        }
      }
    } catch (e) {
      console.error('Task cloud sync failed:', provider, e);
    }
  }
}

export async function removeTaskFromCloudCalendars(
  env: CalendarEnv,
  userId: string,
  taskId: number,
  origin: string
): Promise<void> {
  const providers = await listConnectedProviders(env.DB, userId);
  for (const provider of providers) {
    await removeTaskFromCloudCalendar(env, userId, taskId, provider, origin);
  }
}

async function removeTaskFromCloudCalendar(
  env: CalendarEnv,
  userId: string,
  taskId: number,
  provider: CalendarProvider,
  origin: string
): Promise<void> {
  const map = await readSyncMap(env.DB, taskId, userId, provider);
  if (!map) return;

  let path;
  if (provider === 'apple') {
    path = map.external_event_id;
  } else if (provider === 'google') {
    path = `/calendar/v3/calendars/${encodeURIComponent(map.external_calendar_id)}/events/${encodeURIComponent(map.external_event_id)}`;
  } else {
    path = `/v1.0/me/calendars/${encodeURIComponent(map.external_calendar_id)}/events/${encodeURIComponent(map.external_event_id)}`;
  }

  const resp = await providerApi(env, userId, provider, origin, path, { method: 'DELETE' });
  if (resp && !resp.ok && resp.status !== 404) {
    console.error('Calendar event delete failed:', provider, await resp.text());
  }

  await removeSyncMap(env.DB, taskId, userId, provider);
}

export async function listExternalEvents(
  env: CalendarEnv,
  userId: string,
  provider: CalendarProvider,
  origin: string,
  fromIso: string,
  toIso: string
): Promise<Array<{ id: string; title: string; start: string | null; end: string | null }>> {
  const selected = await getSelectedCalendar(env.DB, userId, provider);
  if (!selected) return [];

  if (provider === 'apple') {
    // Parse + reformat the range instead of interpolating raw query input into XML.
    const toCalDavStamp = (iso: string): string | null => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };
    const rangeStart = toCalDavStamp(fromIso);
    const rangeEnd = toCalDavStamp(toIso);
    if (!rangeStart || !rangeEnd) return [];

    // CalDAV REPORT to fetch events in a range
    const body = `<?xml version="1.0" encoding="utf-8" ?>
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><d:getetag /><c:calendar-data /></d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            <c:comp-filter name="VEVENT">
              <c:time-range start="${rangeStart}" end="${rangeEnd}"/>
            </c:comp-filter>
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>`;

    const resp = await providerApi(env, userId, provider, origin, selected.id, {
      method: 'REPORT',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', Depth: '1' },
      body,
    });

    if (!resp?.ok) return [];
    const xml = await resp.text();
    const events: any[] = [];
    const responses = xml.split(/<response>/i).slice(1);

    for (const r of responses) {
      const dataMatch = r.match(/<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/i);
      const hrefMatch = r.match(/<href[^>]*>(.*?)<\/href>/i);
      if (dataMatch && hrefMatch) {
        const ics = dataMatch[1].trim();
        const summary = ics.match(/SUMMARY:(.*)/i)?.[1] || '(без заглавие)';
        const start = ics.match(/DTSTART(?:;TZID=[^:]+)?:(\d{8}T\d{6})/i)?.[1];
        const end = ics.match(/DTEND(?:;TZID=[^:]+)?:(\d{8}T\d{6})/i)?.[1];

        const format = (s?: string) => {
          if (!s) return null;
          return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`;
        };

        events.push({
          id: hrefMatch[1],
          title: summary.trim(),
          start: format(start),
          end: format(end),
        });
      }
    }
    return events;
  }

  if (provider === 'google') {
    const path = `/calendar/v3/calendars/${encodeURIComponent(selected.id)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(fromIso)}&timeMax=${encodeURIComponent(toIso)}`;
    const resp = await providerApi(env, userId, provider, origin, path, { method: 'GET' });
    if (!resp?.ok) return [];
    const data = parseJsonSafe<{ items?: Array<{ id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }> }>(await resp.text());
    return (data?.items || []).map((ev) => ({
      id: ev.id,
      title: ev.summary || '(без заглавие)',
      start: ev.start?.dateTime || ev.start?.date || null,
      end: ev.end?.dateTime || ev.end?.date || null,
    }));
  }

  const path = `/v1.0/me/calendars/${encodeURIComponent(selected.id)}/events?$top=100&$orderby=start/dateTime&$filter=start/dateTime ge '${fromIso}' and end/dateTime le '${toIso}'`;
  const resp = await providerApi(env, userId, provider, origin, path, { method: 'GET' });
  if (!resp?.ok) return [];
  const data = parseJsonSafe<{ value?: Array<{ id: string; subject?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }> }>(await resp.text());
  return (data?.value || []).map((ev) => ({
    id: ev.id,
    title: ev.subject || '(без заглавие)',
    start: ev.start?.dateTime || null,
    end: ev.end?.dateTime || null,
  }));
}

export function normalizeProvider(value: string | null | undefined): CalendarProvider | null {
  if (value === 'google' || value === 'microsoft' || value === 'apple') return value;
  return null;
}

export function requestOrigin(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

export function providerLabel(provider: CalendarProvider): string {
  if (provider === 'apple') return 'Apple Calendar (iCloud)';
  return provider === 'google' ? 'Google Calendar' : 'Outlook Calendar';
}

export function calendarCapabilities() {
  return {
    primary: ['google', 'microsoft', 'apple-caldav'],
    secondary: [],
    fallback: ['native-device', 'ics-webcal'],
  };
}

// --- Apple CalDAV Helpers ---

async function fetchAppleCalendars(appleId: string, password: string): Promise<Array<{ id: string; name: string; primary: boolean; timezone?: string }>> {
  const auth = btoa(`${appleId}:${password}`);

  // 1. Discovery
  const discResp = await fetch('https://caldav.icloud.com/', {
    method: 'PROPFIND',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'text/xml; charset=utf-8',
      Depth: '0',
    },
    body: `<?xml version="1.0" encoding="utf-8" ?>
      <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop><c:calendar-home-set /></d:prop>
      </d:propfind>`,
  });

  if (!discResp.ok) throw new Error('Apple Discovery failed');
  const discXml = await discResp.text();
  const homeSetMatch = discXml.match(/<calendar-home-set[^>]*>\s*<href[^>]*>(.*?)<\/href>/i);
  if (!homeSetMatch) throw new Error('Could not find Apple calendar home set');
  const homeUrl = homeSetMatch[1];

  // 2. List calendars
  const listResp = await fetch(homeUrl, {
    method: 'PROPFIND',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'text/xml; charset=utf-8',
      Depth: '1',
    },
    body: `<?xml version="1.0" encoding="utf-8" ?>
      <d:propfind xmlns:d="DAV:">
        <d:prop><d:displayname /><d:resourcetype /></d:prop>
      </d:propfind>`,
  });

  if (!listResp.ok) throw new Error('Apple Calendar list failed');
  const listXml = await listResp.text();

  // Simple XML parsing with regex for calendars
  const calendars: Array<{ id: string; name: string; primary: boolean }> = [];
  const responses = listXml.split(/<response>/i).slice(1);

  for (const resp of responses) {
    if (resp.includes('<calendar xmlns="urn:ietf:params:xml:ns:caldav"/>')) {
      const hrefMatch = resp.match(/<href[^>]*>(.*?)<\/href>/i);
      const nameMatch = resp.match(/<displayname[^>]*>(.*?)<\/displayname>/i);
      if (hrefMatch) {
        const href = hrefMatch[1];
        calendars.push({
          id: href.startsWith('http') ? href : new URL(href, homeUrl).toString(),
          name: nameMatch ? nameMatch[1] : 'Apple Calendar',
          primary: nameMatch?.[1]?.toLowerCase() === 'calendar',
        });
      }
    }
  }

  return calendars;
}

export async function connectAppleAccount(
  db: D1Database,
  userId: string,
  appleId: string,
  appSpecificPassword: string,
  origin: string
): Promise<void> {
  // Test connection and sync calendars
  const calendars = await fetchAppleCalendars(appleId, appSpecificPassword);

  await saveConnection(
    db,
    userId,
    'apple',
    appSpecificPassword, // stored as access_token
    '', // refresh_token not used
    expiryFromNow(365 * 24 * 3600), // Far future expiration
    'caldav',
    appleId // stored as provider_user_id
  );

  await upsertCalendars(db, userId, 'apple', calendars);
}
