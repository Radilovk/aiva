import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createTask, getIncompleteTasks, markTaskDone, registerUser } from './tasks';
import { handleCron } from './cron';
import { ensureSchema } from './db';

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GEMINI_API_KEY: string;
}

// --- Cost protection constants ---
const MAX_SESSIONS_PER_DAY = 20;
const SESSION_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes inactivity

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());
app.use('*', async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

// --- REST API ---

app.get('/api/tasks/:user_id', async (c) => {
  const userId = c.req.param('user_id');
  const tasks = await getIncompleteTasks(c.env.DB, userId);
  return c.json({ tasks });
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

// --- Ephemeral token endpoint for frontend ---

app.post('/api/token', async (c) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-live-preview:generateEphemeralToken?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          responseModalities: ['AUDIO', 'TEXT'],
          enableAffectiveDialog: true,
          speechConfig: {
            languageCode: 'bg-BG',
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

// --- WebSocket voice proxy ---

app.get('/ws/voice', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Очаква се WebSocket връзка', 426);
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  const userId = c.req.query('user_id') || 'anonymous';

  // --- Rate limiting: max 20 sessions/day per user ---
  const rateLimitKey = `rate:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const currentCount = parseInt(await c.env.SESSIONS.get(rateLimitKey) || '0', 10);
  if (currentCount >= MAX_SESSIONS_PER_DAY) {
    server.send(JSON.stringify({
      type: 'error',
      message: 'Достигнат е дневният лимит от 20 сесии. Опитайте утре.',
    }));
    server.close(1008, 'Дневен лимит достигнат');
    return new Response(null, { status: 101, webSocket: client });
  }
  await c.env.SESSIONS.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 86400 });

  let geminiWs: WebSocket | null = null;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Inactivity timeout helper ---
  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      server.send(JSON.stringify({
        type: 'error',
        message: 'Сесията е затворена поради неактивност (3 мин).',
      }));
      server.close(1000, 'Timeout поради неактивност');
      geminiWs?.close();
    }, SESSION_TIMEOUT_MS);
  }

  resetInactivityTimer();

  const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${c.env.GEMINI_API_KEY}`;

  // Connect to Gemini Live API
  const geminiResponse = await fetch(GEMINI_WS_URL, {
    headers: { Upgrade: 'websocket' },
  });

  geminiWs = (geminiResponse as any).webSocket as WebSocket;
  if (!geminiWs) {
    server.close(1011, 'Неуспешна връзка с Gemini');
    return new Response(null, { status: 101, webSocket: client });
  }

  geminiWs.accept();

  // Send setup message to Gemini with function calling and activity detection
  const setupMessage = {
    setup: {
      model: 'models/gemini-3.1-flash-live-preview',
      generationConfig: {
        maxOutputTokens: 1024,
        responseModalities: ['AUDIO', 'TEXT'],
        speechConfig: {
          languageCode: 'bg-BG',
        },
      },
      enableAffectiveDialog: true,
      inputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          silenceDurationMs: 2000,
          prefixPaddingMs: 500,
        },
      },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'save_task',
              description: 'Запазва задача след като потребителят я опише. Извикай тази функция когато разбереш какво е задачата.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  task: {
                    type: 'STRING',
                    description: 'Кратка формулировка на задачата на български',
                  },
                  emotion: {
                    type: 'STRING',
                    description: 'Засечена емоция от тона на гласа',
                    enum: ['stress', 'tired', 'urgent', 'neutral'],
                  },
                  priority: {
                    type: 'INTEGER',
                    description: 'Приоритет от 1 (най-висок) до 5 (най-нисък)',
                  },
                  due_date: {
                    type: 'STRING',
                    description: 'Краен срок във формат YYYY-MM-DD или празен ако няма',
                  },
                  estimated_minutes: {
                    type: 'INTEGER',
                    description: 'Прогнозно време за изпълнение в минути',
                  },
                },
                required: ['task', 'emotion', 'priority'],
              },
            },
          ],
        },
      ],
      systemInstruction: {
        parts: [
          {
            text: `Ти си личен асистент за задачи на български език.

ПРАВИЛА:
- Слушаш ТОНА на гласа, не само думите
- Ако потребителят звучи стресирано → отговаряш спокойно и уверено
- Ако звучи уморено → отговаряш много кратко
- Ако звучи бързащо → веднага минаваш към същественото
- Задаваш САМО ЕДИН въпрос
- НИКОГА не задаваш повече от един въпрос
- Говориш само на български
- Когато разбереш задачата, ИЗВИКАЙ функцията save_task с правилните параметри`,
          },
        ],
      },
    },
  };

  geminiWs.send(JSON.stringify(setupMessage));

  // Handle messages from Gemini
  geminiWs.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data as string);

      // Handle function call (save_task) from Gemini
      if (data.toolCall) {
        for (const call of data.toolCall.functionCalls || []) {
          if (call.name === 'save_task') {
            handleFunctionCallSaveTask(call, userId, c.env.DB, server, geminiWs!);
          }
        }
        return;
      }

      // Forward audio back to client
      if (data.serverContent?.modelTurn?.parts) {
        for (const part of data.serverContent.modelTurn.parts) {
          if (part.inlineData) {
            server.send(JSON.stringify({
              type: 'audio',
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType,
            }));
          }
          if (part.text) {
            server.send(JSON.stringify({ type: 'text', data: part.text }));
          }
        }
      }

      // Forward input transcription to client
      if (data.serverContent?.inputTranscription) {
        server.send(JSON.stringify({
          type: 'transcription',
          data: data.serverContent.inputTranscription.text || '',
        }));
      }

      // Check if turn is complete
      if (data.serverContent?.turnComplete) {
        server.send(JSON.stringify({ type: 'turnComplete' }));
      }
    } catch (e) {
      console.error('Error processing Gemini message:', e);
    }
  });

  geminiWs.addEventListener('close', () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    server.close(1000, 'Gemini връзката е затворена');
  });

  geminiWs.addEventListener('error', (e) => {
    console.error('Gemini WS error:', e);
    if (inactivityTimer) clearTimeout(inactivityTimer);
    server.close(1011, 'Грешка в Gemini връзката');
  });

  // Handle messages from client
  server.addEventListener('message', (event) => {
    if (!geminiWs) return;
    resetInactivityTimer();

    try {
      const msg = JSON.parse(event.data as string);

      if (msg.type === 'audio') {
        geminiWs.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: 'audio/pcm;rate=16000',
                data: msg.data,
              },
            ],
          },
        }));
      }
    } catch (e) {
      // Binary data - forward as PCM audio
      if (event.data instanceof ArrayBuffer) {
        const base64 = arrayBufferToBase64(event.data);
        geminiWs.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: 'audio/pcm;rate=16000',
                data: base64,
              },
            ],
          },
        }));
      }
    }
  });

  server.addEventListener('close', () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    geminiWs?.close();
  });

  return new Response(null, { status: 101, webSocket: client });
});

// --- Helper functions ---

async function handleFunctionCallSaveTask(
  call: { id: string; name: string; args: any },
  userId: string,
  db: D1Database,
  ws: WebSocket,
  geminiWs: WebSocket
): Promise<void> {
  const args = call.args || {};

  if (!args.task) {
    geminiWs.send(JSON.stringify({
      toolResponse: {
        functionResponses: [{
          id: call.id,
          response: { error: 'Липсва описание на задачата' },
        }],
      },
    }));
    return;
  }

  try {
    const task = await createTask(db, {
      user_id: userId,
      content: args.task,
      emotion: args.emotion || 'neutral',
      priority: Math.min(5, Math.max(1, parseInt(args.priority) || 3)),
      due_date: args.due_date || null,
      estimated_minutes: args.estimated_minutes ? parseInt(args.estimated_minutes) : null,
    });

    ws.send(JSON.stringify({ type: 'taskSaved', task }));

    // Respond to Gemini so it can confirm to the user
    geminiWs.send(JSON.stringify({
      toolResponse: {
        functionResponses: [{
          id: call.id,
          response: { success: true, task_id: task.id, content: task.content },
        }],
      },
    }));
  } catch (e) {
    console.error('D1 save error:', e);
    ws.send(JSON.stringify({ type: 'error', message: 'Грешка при запис на задачата.' }));
    geminiWs.send(JSON.stringify({
      toolResponse: {
        functionResponses: [{
          id: call.id,
          response: { error: 'Грешка при запис' },
        }],
      },
    }));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// --- Static file serving for frontend ---

app.get('/', async (c) => {
  return c.redirect('/index.html');
});

// --- Export ---

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      await ensureSchema(env.DB);
      await handleCron(env);
    })());
  },
};
