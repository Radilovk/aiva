import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createTask, getIncompleteTasks, markTaskDone, registerUser } from './tasks';
import { handleCron } from './cron';

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GEMINI_API_KEY: string;
}

// --- Cost protection constants ---
const MAX_SESSIONS_PER_DAY = 50;

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// --- REST API ---

app.get('/api/tasks/:user_id', async (c) => {
  const userId = c.req.param('user_id');
  try {
    const tasks = await getIncompleteTasks(c.env.DB, userId);
    return c.json({ tasks });
  } catch (e) {
    console.error('Get tasks error:', e);
    return c.json({ tasks: [] }, 500);
  }
});

app.patch('/api/tasks/:id/done', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const success = await markTaskDone(c.env.DB, id);
  if (!success) return c.json({ error: 'Задачата не е намерена' }, 404);
  return c.json({ success: true });
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

  const rateLimitKey = `rate:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const currentCount = parseInt(await c.env.SESSIONS.get(rateLimitKey) || '0', 10);
  if (currentCount >= MAX_SESSIONS_PER_DAY) {
    return c.json({ error: 'Достигнат е дневният лимит от сесии. Опитайте утре.' }, 429);
  }
  await c.env.SESSIONS.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 86400 });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateEphemeralToken?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          responseModalities: ['AUDIO', 'TEXT'],
          enableAffectiveDialog: true,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error('Token generation failed:', errText);
    return c.json({ error: 'Неуспешно генериране на токен' }, 500);
  }

  const data = await response.json() as any;
  return c.json(data);
});

// --- Save task endpoint (called directly by frontend after Gemini function call) ---

app.post('/api/tasks', async (c) => {
  const body = await c.req.json<{
    user_id: string;
    task: string;
    emotion?: string;
    priority?: number;
    due_date?: string;
    estimated_minutes?: number;
  }>();

  if (!body.user_id || !body.task) {
    return c.json({ error: 'user_id и task са задължителни' }, 400);
  }

  try {
    const task = await createTask(c.env.DB, {
      user_id: body.user_id,
      content: body.task,
      emotion: body.emotion || 'neutral',
      priority: Math.min(5, Math.max(1, parseInt(String(body.priority)) || 3)),
      due_date: body.due_date || null,
      estimated_minutes: body.estimated_minutes ? parseInt(String(body.estimated_minutes)) : null,
    });
    return c.json({ success: true, task });
  } catch (e) {
    console.error('Task save error:', e);
    return c.json({ error: 'Грешка при запис на задачата' }, 500);
  }
});

// --- Static file serving for frontend ---

app.get('/', async (c) => {
  return c.redirect('/index.html');
});

// --- Stub for delete-class migration (remove after successful deploy) ---
export class VoiceWebSocket {
  constructor(private state: DurableObjectState, private env: Env) {}
  async fetch(_request: Request) {
    return new Response('This Durable Object is being deleted', { status: 410 });
  }
}

// --- Export ---

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleCron(env));
  },
};
