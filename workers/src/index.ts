import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createTask,
  countIncompleteTasks,
  deleteTask,
  duplicateTask,
  getIncompleteTasks,
  getTaskById,
  markTaskDone,
  registerUser,
  searchTasks,
  updateTask,
} from './tasks';
import { handleCron } from './cron';
import {
  calendarCapabilities,
  completeOAuthConnect,
  connectAppleAccount,
  disconnectProvider,
  getProviderStatuses,
  listExternalEvents,
  listProviderCalendars,
  normalizeProvider,
  removeTaskFromCloudCalendars,
  requestOrigin,
  setSelectedCalendar,
  startOAuthConnect,
  syncTaskToCloudCalendars,
} from './calendar';
import {
  TIER_LIMITS,
  getEffectiveSubscription,
  getStripeCatalog,
  resolvePlanPriceId,
} from './subscription';
import {
  createCheckoutSession,
  createPortalSession,
  handleStripeWebhook,
  type StripeEnv,
} from './stripe';

interface Env extends StripeEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GEMINI_API_KEY: string;
  MAX_SESSIONS_PER_DAY?: string;
  MAX_SESSIONS_PER_IP?: string;
  MAX_PREVIEWS_PER_IP?: string;
  SUBSCRIPTION_ENFORCED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_REDIRECT_URI?: string;
  MICROSOFT_TENANT_ID?: string;
}

// --- Cost protection: daily limits (overridable via wrangler vars) ---
const DEFAULT_MAX_SESSIONS_PER_DAY = 15;
const DEFAULT_MAX_SESSIONS_PER_IP = 40;
const DEFAULT_MAX_PREVIEWS_PER_IP = 10;

function envInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function getDailyCount(kv: KVNamespace, key: string): Promise<number> {
  const val = await kv.get(key);
  const n = parseInt(val || '', 10);
  return Number.isFinite(n) ? n : 0;
}

async function resolveSessionLimit(env: Env, userId: string): Promise<number> {
  const effective = await getEffectiveSubscription(env, userId, envInt);
  return effective.limits.sessions_per_day;
}

function plusRequiredResponse(c: { json: (body: unknown, status?: number) => Response }) {
  return c.json({
    error: 'Тази функция изисква KASY Plus.',
    code: 'PLUS_REQUIRED',
  }, 403);
}

/** Increments a per-day KV counter; returns false when the limit is reached. */
async function incrementDailyLimit(kv: KVNamespace, key: string, limit: number): Promise<boolean> {
  const fullKey = `${key}:${new Date().toISOString().slice(0, 10)}`;
  const current = parseInt((await kv.get(fullKey)) || '0', 10);
  if (current >= limit) return false;
  await kv.put(fullKey, String(current + 1), { expirationTtl: 86400 });
  return true;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ALLOWED_ORIGINS = new Set([
  'https://aiva.radilov-k.workers.dev',
  'https://radilovk.github.io',
  'https://localhost', // Capacitor Android shell
  'capacitor://localhost', // Capacitor iOS shell
]);

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : ''),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'If-None-Match'],
    exposeHeaders: ['ETag'],
  })
);

// --- REST API ---

app.get('/api/tasks/:user_id', async (c) => {
  const userId = c.req.param('user_id');
  try {
    const tasks = await getIncompleteTasks(c.env.DB, userId);
    // ETag от съдържанието: при непроменен списък клиентът получава празен
    // 304 вместо целия JSON — нулев трансфер при всяко "нищо ново" опресняване.
    const etag = `"${await sha256Hex(JSON.stringify(tasks))}"`;
    if (c.req.header('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    return c.json({ tasks }, 200, { ETag: etag });
  } catch (e) {
    console.error('Get tasks error:', e);
    return c.json({ tasks: [] }, 500);
  }
});

app.patch('/api/tasks/:id/done', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) {
    return c.json({ error: 'Невалиден идентификатор на задача' }, 400);
  }
  const body = await c.req.json<{ user_id?: string }>().catch(() => ({} as { user_id?: string }));
  const userId = body?.user_id || c.req.query('user_id');
  if (!userId) {
    return c.json({ error: 'user_id е задължителен' }, 400);
  }
  const result = await markTaskDone(c.env.DB, id, userId);
  if (!result.changed) return c.json({ error: 'Задачата не е намерена' }, 404);

  const origin = requestOrigin(new URL(c.req.url));
  if (result.task) {
    c.executionCtx.waitUntil(removeTaskFromCloudCalendars(c.env, result.task.user_id, result.task.id, origin));
  }
  // Recurring task: sync the auto-created next occurrence in the background
  if (result.next) {
    c.executionCtx.waitUntil(syncTaskToCloudCalendars(c.env, result.next, origin));
  }
  return c.json({ success: true, next_task: result.next ?? null });
});

app.patch('/api/tasks/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<{
    user_id?: string;
    content?: string;
    task?: string;
    emotion?: string | null;
    priority?: number;
    due_date?: string | null;
    due_time?: string | null;
    estimated_minutes?: number | null;
    notes?: string | null;
    location?: string | null;
    repeat_rule?: string | null;
    tags?: string | null;
    done?: number;
  }>();

  if (!Number.isFinite(id)) {
    return c.json({ error: 'Невалиден идентификатор на задача' }, 400);
  }

  try {
    const task = await updateTask(
      c.env.DB,
      id,
      {
        content: body.content ?? body.task,
        emotion: body.emotion,
        priority: body.priority,
        due_date: body.due_date,
        due_time: body.due_time,
        estimated_minutes: body.estimated_minutes,
        notes: body.notes,
        location: body.location,
        repeat_rule: body.repeat_rule,
        tags: body.tags,
        done: body.done,
      },
      body.user_id
    );
    if (!task) return c.json({ error: 'Задачата не е намерена' }, 404);
    c.executionCtx.waitUntil(syncTaskToCloudCalendars(c.env, task, requestOrigin(new URL(c.req.url))));
    return c.json({ success: true, task });
  } catch (e) {
    console.error('Task update error:', e);
    return c.json({ error: 'Грешка при редакция на задачата' }, 500);
  }
});

app.delete('/api/tasks/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<{ user_id?: string }>().catch(() => ({} as { user_id?: string }));

  if (!Number.isFinite(id)) {
    return c.json({ error: 'Невалиден идентификатор на задача' }, 400);
  }

  try {
    const existingTask = await getTaskById(c.env.DB, id, body.user_id);
    const success = await deleteTask(c.env.DB, id, body.user_id);
    if (!success) return c.json({ error: 'Задачата не е намерена' }, 404);
    if (existingTask) {
      c.executionCtx.waitUntil(
        removeTaskFromCloudCalendars(c.env, existingTask.user_id, existingTask.id, requestOrigin(new URL(c.req.url)))
      );
    }
    return c.json({ success: true });
  } catch (e) {
    console.error('Task delete error:', e);
    return c.json({ error: 'Грешка при изтриване на задачата' }, 500);
  }
});

app.post('/api/tasks/:id/duplicate', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<{
    user_id: string;
    due_date?: string | null;
    due_time?: string | null;
    repeat_rule?: string | null;
    notes?: string | null;
  }>();

  if (!Number.isFinite(id)) {
    return c.json({ error: 'Невалиден идентификатор на задача' }, 400);
  }
  if (!body.user_id) {
    return c.json({ error: 'user_id е задължителен' }, 400);
  }

  try {
    const task = await duplicateTask(c.env.DB, id, body.user_id, {
      due_date: body.due_date,
      due_time: body.due_time,
      repeat_rule: body.repeat_rule,
      notes: body.notes,
    });
    if (!task) return c.json({ error: 'Задачата не е намерена' }, 404);
    return c.json({ success: true, task });
  } catch (e) {
    console.error('Task duplicate error:', e);
    return c.json({ error: 'Грешка при мултиплициране на задачата' }, 500);
  }
});

app.post('/api/users/register', async (c) => {
  const body = await c.req.json<{ user_id: string; app_token: string }>();
  if (!body.user_id || !body.app_token) {
    return c.json({ error: 'user_id и app_token са задължителни' }, 400);
  }
  await registerUser(c.env.DB, body.user_id, body.app_token);
  return c.json({ success: true });
});

// --- Ephemeral token endpoint for frontend (includes rate limiting) ---

app.post('/api/token', async (c) => {
  const body = await c.req.json<{ user_id?: string }>().catch(() => ({} as any));
  const userId = body?.user_id || 'anonymous';

  // Двоен дневен лимит: по потребител + по IP (user_id идва от клиента и може да се ротира)
  const userLimit = await resolveSessionLimit(c.env, userId);
  const ipLimit = envInt(c.env.MAX_SESSIONS_PER_IP, DEFAULT_MAX_SESSIONS_PER_IP);
  const ip = c.req.header('cf-connecting-ip') || 'unknown';

  if (!(await incrementDailyLimit(c.env.SESSIONS, `rate:${userId}`, userLimit))) {
    return c.json({
      error: 'Достигнат е дневният лимит от гласови сесии. Опитайте утре или надградете до Plus.',
      code: 'SESSION_LIMIT',
    }, 429);
  }
  if (!(await incrementDailyLimit(c.env.SESSIONS, `rate:ip:${ip}`, ipLimit))) {
    return c.json({ error: 'Достигнат е дневният лимит от гласови сесии за тази мрежа. Опитайте утре.' }, 429);
  }

  const now = new Date();
  const expireTime = new Date(now.getTime() + 30 * 60 * 1000); // 30 min
  const newSessionExpireTime = new Date(now.getTime() + 2 * 60 * 1000); // 2 min

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uses: 1,
        expireTime: expireTime.toISOString(),
        newSessionExpireTime: newSessionExpireTime.toISOString(),
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error('Token generation failed:', errText);
    return c.json({ error: 'Неуспешно генериране на токен' }, 500);
  }

  const data = await response.json() as any;
  return c.json({ token: data.name, expires_at: expireTime.toISOString() });
});

app.post('/api/voice-preview', async (c) => {
  const body = await c.req.json<{
    voice_name?: string;
    text?: string;
    language?: string;
    user_id?: string;
  }>().catch(() => ({} as { voice_name?: string; text?: string; language?: string; user_id?: string }));

  const voiceName = /^[A-Za-z][A-Za-z -]{0,30}$/.test(body.voice_name || '') ? body.voice_name! : 'Kore';
  const text = (body.text || 'Здравейте! Аз съм KASY, вашият AI Secretary. С какво мога да ви помогна?').slice(0, 120);
  const userId = body.user_id || 'anonymous';

  // Кеш по глас+текст: гласовете са краен брой, така TTS API се вика веднъж на комбинация
  const cacheKey = `tts:${voiceName}:${await sha256Hex(text)}`;
  const cached = await c.env.SESSIONS.get(cacheKey, 'json') as { audio: string; mime_type: string } | null;
  if (cached?.audio) return c.json(cached);

  const previewLimit = envInt(c.env.MAX_PREVIEWS_PER_IP, DEFAULT_MAX_PREVIEWS_PER_IP);
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const effective = await getEffectiveSubscription(c.env, userId, envInt);
  if (effective.enforced) {
    const userPreviewKey = `rate:preview:user:${userId}`;
    const userPreviewCount = await getDailyCount(c.env.SESSIONS, userPreviewKey);
    if (userPreviewCount >= effective.limits.voice_preview_per_day) {
      return c.json({ error: 'Достигнат е дневният лимит за аудио примери.', code: 'PREVIEW_LIMIT' }, 429);
    }
    await incrementDailyLimit(c.env.SESSIONS, userPreviewKey, effective.limits.voice_preview_per_day + 1);
  }
  if (!(await incrementDailyLimit(c.env.SESSIONS, `rate:preview:${ip}`, previewLimit))) {
    return c.json({ error: 'Достигнат е дневният лимит за аудио примери. Опитайте утре.' }, 429);
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error('Voice preview failed:', errText);
    return c.json({ error: 'Неуспешно генериране на аудио пример' }, 500);
  }

  const data = await response.json() as any;
  const inlineData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  const audioB64 = inlineData?.data;
  if (!audioB64) {
    return c.json({ error: 'Липсва аудио в отговора' }, 500);
  }

  const payload = {
    audio: audioB64,
    mime_type: inlineData?.mimeType || 'audio/L16;codec=pcm;rate=24000',
  };
  c.executionCtx.waitUntil(
    c.env.SESSIONS.put(cacheKey, JSON.stringify(payload), { expirationTtl: 30 * 86400 })
  );
  return c.json(payload);
});

// --- Daily brief (generated by the evening cron, stored in KV) ---

app.get('/api/brief/:user_id', async (c) => {
  const userId = c.req.param('user_id');
  const effective = await getEffectiveSubscription(c.env, userId, envInt);
  if (effective.enforced && !effective.limits.daily_brief) {
    return c.json({ brief: null, locked: true });
  }
  const brief = await c.env.SESSIONS.get(`brief:${userId}`, 'json');
  return c.json({ brief: brief ?? null });
});

// --- Save task endpoint (called directly by frontend after Gemini function call) ---

app.post('/api/tasks', async (c) => {
  const body = await c.req.json<{
    user_id: string;
    task: string;
    content?: string;
    emotion?: string;
    priority?: number;
    due_date?: string;
    due_time?: string;
    estimated_minutes?: number;
    notes?: string;
    location?: string;
    repeat_rule?: string;
    tags?: string;
  }>();

  if (!body.user_id || !(body.task || body.content)) {
    return c.json({ error: 'user_id и task са задължителни' }, 400);
  }

  const effective = await getEffectiveSubscription(c.env, body.user_id, envInt);
  if (effective.enforced) {
    const activeCount = await countIncompleteTasks(c.env.DB, body.user_id);
    if (activeCount >= effective.limits.max_active_tasks) {
      return c.json({
        error: 'Достигнат е лимитът на активни задачи. Надградете до KASY Plus.',
        code: 'TASK_LIMIT',
      }, 403);
    }
  }

  try {
    const task = await createTask(c.env.DB, {
      user_id: body.user_id,
      content: body.task || body.content || '',
      emotion: body.emotion || 'neutral',
      priority: Math.min(5, Math.max(1, parseInt(String(body.priority)) || 3)),
      due_date: body.due_date || null,
      due_time: body.due_time || null,
      estimated_minutes: body.estimated_minutes ? parseInt(String(body.estimated_minutes)) : null,
      notes: body.notes || null,
      location: body.location || null,
      repeat_rule: body.repeat_rule || null,
      tags: body.tags || null,
    });
    c.executionCtx.waitUntil(syncTaskToCloudCalendars(c.env, task, requestOrigin(new URL(c.req.url))));
    return c.json({ success: true, task });
  } catch (e) {
    console.error('Task save error:', e);
    return c.json({ error: 'Грешка при запис на задачата' }, 500);
  }
});

// --- Cloud calendar providers (Google + Microsoft primary flow) ---

app.get('/api/calendar/providers/status/:user_id', async (c) => {
  const userId = c.req.param('user_id');
  const providers = await getProviderStatuses(c.env, userId);
  return c.json({
    providers,
    capabilities: calendarCapabilities(),
  });
});

app.post('/api/calendar/connect/start', async (c) => {
  const body = await c.req.json<{
    user_id?: string;
    provider?: string;
    redirect_uri?: string;
  }>().catch(() => ({} as { user_id?: string; provider?: string; redirect_uri?: string }));

  const provider = normalizeProvider(body.provider);
  if (!body.user_id || !provider) {
    return c.json({ error: 'user_id и provider са задължителни' }, 400);
  }

  const effective = await getEffectiveSubscription(c.env, body.user_id, envInt);
  if (effective.enforced && !effective.limits.cloud_calendar) {
    return plusRequiredResponse(c);
  }

  try {
    const { url, state } = await startOAuthConnect(
      c.env,
      provider,
      body.user_id,
      requestOrigin(new URL(c.req.url)),
      body.redirect_uri
    );
    return c.json({ url, state });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'OAuth start error' }, 400);
  }
});

app.post('/api/calendar/connect/apple', async (c) => {
  const body = await c.req.json<{
    user_id?: string;
    apple_id?: string;
    password?: string;
  }>().catch(() => ({} as any));

  if (!body.user_id || !body.apple_id || !body.password) {
    return c.json({ error: 'user_id, apple_id и password са задължителни' }, 400);
  }

  const effective = await getEffectiveSubscription(c.env, body.user_id, envInt);
  if (effective.enforced && !effective.limits.cloud_calendar) {
    return plusRequiredResponse(c);
  }

  try {
    await connectAppleAccount(
      c.env.DB,
      body.user_id,
      body.apple_id,
      body.password,
      requestOrigin(new URL(c.req.url))
    );
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Apple connect error' }, 400);
  }
});

app.post('/api/calendar/connect/callback', async (c) => {
  const body = await c.req.json<{
    user_id?: string;
    provider?: string;
    code?: string;
    state?: string;
    redirect_uri?: string;
  }>().catch(() => ({} as { user_id?: string; provider?: string; code?: string; state?: string; redirect_uri?: string }));

  const provider = normalizeProvider(body.provider);
  if (!body.user_id || !provider || !body.code || !body.state) {
    return c.json({ error: 'user_id, provider, code и state са задължителни' }, 400);
  }

  try {
    await completeOAuthConnect(c.env, {
      userId: body.user_id,
      provider,
      code: body.code,
      state: body.state,
      origin: requestOrigin(new URL(c.req.url)),
      redirectUri: body.redirect_uri,
    });
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'OAuth callback error' }, 400);
  }
});

app.get('/api/calendar/calendars', async (c) => {
  const userId = c.req.query('user_id');
  const provider = normalizeProvider(c.req.query('provider'));
  if (!userId || !provider) {
    return c.json({ error: 'user_id и provider са задължителни' }, 400);
  }

  try {
    const calendars = await listProviderCalendars(c.env, userId, provider, requestOrigin(new URL(c.req.url)));
    return c.json({ calendars });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Calendar list error' }, 500);
  }
});

app.post('/api/calendar/calendars/select', async (c) => {
  const body = await c.req.json<{
    user_id?: string;
    provider?: string;
    calendar_id?: string;
  }>().catch(() => ({} as { user_id?: string; provider?: string; calendar_id?: string }));
  const provider = normalizeProvider(body.provider);
  if (!body.user_id || !provider || !body.calendar_id) {
    return c.json({ error: 'user_id, provider и calendar_id са задължителни' }, 400);
  }

  await setSelectedCalendar(c.env.DB, body.user_id, provider, body.calendar_id);
  return c.json({ success: true });
});

app.delete('/api/calendar/connect', async (c) => {
  const body = await c.req.json<{ user_id?: string; provider?: string }>().catch(() => ({} as { user_id?: string; provider?: string }));
  const provider = normalizeProvider(body.provider);
  if (!body.user_id || !provider) {
    return c.json({ error: 'user_id и provider са задължителни' }, 400);
  }
  await disconnectProvider(c.env.DB, body.user_id, provider);
  return c.json({ success: true });
});

app.get('/api/calendar/events', async (c) => {
  const userId = c.req.query('user_id');
  const provider = normalizeProvider(c.req.query('provider'));
  if (!userId || !provider) {
    return c.json({ error: 'user_id и provider са задължителни' }, 400);
  }

  const from = c.req.query('from') || new Date().toISOString();
  const to = c.req.query('to') || new Date(Date.now() + 14 * 86400000).toISOString();
  const events = await listExternalEvents(c.env, userId, provider, requestOrigin(new URL(c.req.url)), from, to);
  return c.json({ events });
});

// --- Search tasks endpoint (for voice commands) ---

app.get('/api/tasks/:user_id/search', async (c) => {
  const userId = c.req.param('user_id');
  const query = c.req.query('q') || '';
  if (!query.trim()) return c.json({ tasks: [] });

  try {
    const tasks = await searchTasks(c.env.DB, userId, query);
    return c.json({ tasks });
  } catch (e) {
    console.error('Search tasks error:', e);
    return c.json({ tasks: [] }, 500);
  }
});

// --- ICS Calendar feed (webcal subscription — simplest cross-platform sync) ---

function escapeICS(s: string): string {
  return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toICSStamp(isoOrSql: string | null | undefined): string {
  const d = isoOrSql ? new Date(isoOrSql.replace(' ', 'T')) : new Date();
  if (Number.isNaN(d.getTime())) return toICSStamp(null);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

const SOFIA_TZ = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Sofia',
  'BEGIN:STANDARD',
  'DTSTART:19701025T040000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10',
  'TZOFFSETFROM:+0300',
  'TZOFFSETTO:+0200',
  'TZNAME:EET',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700329T030000',
  'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0300',
  'TZNAME:EEST',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
];

app.get('/api/calendar.ics', async (c) => {
  const userId = c.req.query('user_id');
  if (!userId) return c.text('user_id е задължителен', 400);

  const reminderParam = parseInt(c.req.query('reminder') || '15', 10);
  const reminderMinutes = Math.min(120, Math.max(0, Number.isNaN(reminderParam) ? 15 : reminderParam));
  const remindAtStart = c.req.query('at_start') !== '0';

  try {
    const tasks = await getIncompleteTasks(c.env.DB, userId);
    const nowStamp = toICSStamp(null);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AIVA//Task Calendar//BG',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:KASY Задачи',
      'X-WR-TIMEZONE:Europe/Sofia',
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
      'X-PUBLISHED-TTL:PT15M',
      ...SOFIA_TZ,
    ];

    for (const task of tasks) {
      if (!task.due_date) continue;

      const dateStr = task.due_date.replace(/-/g, '');
      const timeStr = task.due_time ? task.due_time.replace(':', '') + '00' : '090000';
      const dtStart = `${dateStr}T${timeStr}`;

      // Wall-clock date math via Date (UTC-anchored) so events past midnight roll the date over
      const durationMin = task.estimated_minutes || 30;
      const startDate = new Date(`${task.due_date}T${task.due_time || '09:00'}:00Z`);
      const endDate = new Date(startDate.getTime() + durationMin * 60000);
      const p2 = (n: number) => String(n).padStart(2, '0');
      const dtEnd =
        `${endDate.getUTCFullYear()}${p2(endDate.getUTCMonth() + 1)}${p2(endDate.getUTCDate())}` +
        `T${p2(endDate.getUTCHours())}${p2(endDate.getUTCMinutes())}00`;
      const modified = toICSStamp(task.updated_at || task.created_at);

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:aiva-task-${task.id}@aiva.radilov-k.workers.dev`);
      lines.push(`DTSTAMP:${nowStamp}`);
      lines.push(`LAST-MODIFIED:${modified}`);
      lines.push(`DTSTART;TZID=Europe/Sofia:${dtStart}`);
      lines.push(`DTEND;TZID=Europe/Sofia:${dtEnd}`);
      lines.push(`SUMMARY:${escapeICS(task.content)}`);
      if (task.notes) lines.push(`DESCRIPTION:${escapeICS(task.notes)}`);
      if (task.location) lines.push(`LOCATION:${escapeICS(task.location)}`);
      lines.push(`PRIORITY:${Math.min(9, task.priority * 2)}`);
      if (task.tags) lines.push(`CATEGORIES:${escapeICS(task.tags)}`);
      if (reminderMinutes > 0) {
        lines.push('BEGIN:VALARM');
        lines.push(`TRIGGER:-PT${reminderMinutes}M`);
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:${escapeICS(task.content)}`);
        lines.push('END:VALARM');
      }
      if (remindAtStart) {
        lines.push('BEGIN:VALARM');
        lines.push('TRIGGER:-PT0M');
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:${escapeICS('Започва: ' + task.content)}`);
        lines.push('END:VALARM');
      }
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    return new Response(lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="aiva-tasks.ics"',
        'Cache-Control': 'no-cache, max-age=0, must-revalidate',
      },
    });
  } catch (e) {
    console.error('ICS generation error:', e);
    return c.text('Грешка при генериране на ICS', 500);
  }
});

// --- User profile sync (language for server-side briefs) ---

app.post('/api/profile', async (c) => {
  const body = await c.req.json<{ user_id?: string; language?: string }>().catch(() => null);
  if (!body?.user_id) {
    return c.json({ error: 'user_id е задължителен' }, 400);
  }
  const language = body.language || 'bg';
  try {
    await c.env.SESSIONS.put(
      `profile:${body.user_id}`,
      JSON.stringify({ language }),
      { expirationTtl: 365 * 86400 }
    );
    return c.json({ success: true });
  } catch (e) {
    console.error('Profile sync error:', e);
    return c.json({ error: 'Грешка при запис на профил' }, 500);
  }
});

// --- Subscription & Stripe (see docs/MONETIZATION.md) ---

app.get('/api/subscription', async (c) => {
  const userId = c.req.query('user_id');
  if (!userId) return c.json({ error: 'user_id е задължителен' }, 400);

  const effective = await getEffectiveSubscription(c.env, userId, envInt);
  const catalog = getStripeCatalog(c.env);
  const day = new Date().toISOString().slice(0, 10);
  const sessionsUsed = await getDailyCount(c.env.SESSIONS, `rate:${userId}:${day}`);
  const activeTasks = await countIncompleteTasks(c.env.DB, userId);

  return c.json({
    tier: effective.tier,
    status: effective.status,
    current_period_end: effective.current_period_end,
    limits: effective.limits,
    enforced: effective.enforced,
    stripe_configured: effective.stripe_configured,
    usage: {
      sessions_today: sessionsUsed,
      active_tasks: activeTasks,
    },
    catalog,
    tiers: {
      free: { limits: TIER_LIMITS.free },
      plus: { limits: TIER_LIMITS.plus },
      pro: { limits: TIER_LIMITS.pro },
    },
  });
});

app.post('/api/stripe/checkout', async (c) => {
  const body = await c.req.json<{ user_id?: string; plan?: string; price_id?: string }>().catch(() => null);
  if (!body?.user_id) {
    return c.json({ error: 'user_id е задължителен' }, 400);
  }
  const priceId = body.plan
    ? resolvePlanPriceId(body.plan, c.env)
    : body.price_id;
  if (!priceId) {
    return c.json({ error: 'Невалиден план или липсва price_id' }, 400);
  }
  try {
    const origin = requestOrigin(new URL(c.req.url));
    const { url } = await createCheckoutSession(c.env, body.user_id, priceId, origin, body.plan);
    return c.json({ url });
  } catch (e) {
    console.error('Stripe checkout error:', e);
    return c.json({ error: (e as Error).message || 'Грешка при Checkout' }, 500);
  }
});

app.post('/api/stripe/portal', async (c) => {
  const body = await c.req.json<{ user_id?: string }>().catch(() => null);
  if (!body?.user_id) return c.json({ error: 'user_id е задължителен' }, 400);
  try {
    const origin = requestOrigin(new URL(c.req.url));
    const { url } = await createPortalSession(c.env, body.user_id, origin);
    return c.json({ url });
  } catch (e) {
    console.error('Stripe portal error:', e);
    return c.json({ error: (e as Error).message || 'Грешка при Portal' }, 500);
  }
});

app.post('/api/stripe/webhook', async (c) => {
  const signature = c.req.header('stripe-signature') || '';
  const payload = await c.req.text();
  try {
    await handleStripeWebhook(c.env, payload, signature);
    return c.json({ received: true });
  } catch (e) {
    console.error('Stripe webhook error:', e);
    return c.json({ error: (e as Error).message || 'Webhook failed' }, 400);
  }
});

// --- Brand package (global, set from admin panel) ---

const BRAND_PACKAGE_KEY = 'brand:package';

app.get('/api/brand-config', async (c) => {
  try {
    const stored = await c.env.SESSIONS.get(BRAND_PACKAGE_KEY);
    const pkg = stored === 'A' ? 'A' : 'B';
    return c.json({ package: pkg });
  } catch (e) {
    console.error('Brand config read error:', e);
    return c.json({ package: 'B' });
  }
});

app.post('/api/admin/brand-package', async (c) => {
  const body = await c.req.json<{ package?: string }>().catch(() => null);
  const pkg = body?.package === 'A' ? 'A' : 'B';
  try {
    await c.env.SESSIONS.put(BRAND_PACKAGE_KEY, pkg);
    return c.json({ success: true, package: pkg });
  } catch (e) {
    console.error('Brand package save error:', e);
    return c.json({ error: 'Грешка при запис на brand package' }, 500);
  }
});

// --- Push subscription endpoint ---

app.post('/api/push/subscribe', async (c) => {
  const body = await c.req.json<{ user_id: string; subscription: any }>().catch(() => null);
  if (!body?.user_id || !body?.subscription) {
    return c.json({ error: 'user_id и subscription са задължителни' }, 400);
  }

  try {
    const key = `push:${body.user_id}`;
    await c.env.SESSIONS.put(key, JSON.stringify(body.subscription), { expirationTtl: 30 * 86400 });
    return c.json({ success: true });
  } catch (e) {
    console.error('Push subscribe error:', e);
    return c.json({ error: 'Грешка при запис на subscription' }, 500);
  }
});

// --- Static file serving for frontend ---

app.get('/', async (c) => {
  return c.redirect('/landing.html');
});

// --- Legacy Durable Object stub ---
// The old VoiceWebSocket DO namespace still exists on the account and the
// Workers Builds CI deploys via "versions upload", which cannot apply DO
// migrations — so the class export must stay or every deploy fails with
// error 10064. To remove it for good: run `npx wrangler deploy` locally once
// (it applies the delete-class migration from wrangler.jsonc), then delete
// this stub and the migrations block.
export class VoiceWebSocket {
  async fetch(_request: Request) {
    return new Response('This Durable Object is no longer used', { status: 410 });
  }
}

// --- Export ---

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleCron(env));
  },
};
