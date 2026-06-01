import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createTask, getIncompleteTasks, markTaskDone, registerUser } from './tasks';
import { handleCron } from './cron';

interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GEMINI_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

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
          responseModalities: ['AUDIO'],
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
  let geminiWs: WebSocket | null = null;
  let accumulatedText = '';

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

  // Send setup message to Gemini
  const setupMessage = {
    setup: {
      model: 'models/gemini-3.1-flash-live-preview',
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          languageCode: 'bg-BG',
        },
      },
      enableAffectiveDialog: true,
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
  
  СЛЕД като разбереш задачата, върни JSON:
  {
    "task": "кратка формулировка",
    "emotion": "stress|tired|urgent|neutral",
    "priority": 1,
    "due_date": "YYYY-MM-DD или null",
    "estimated_minutes": 30
  }`,
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
            accumulatedText += part.text;
          }
        }
      }

      // Check if turn is complete
      if (data.serverContent?.turnComplete) {
        server.send(JSON.stringify({ type: 'turnComplete' }));

        // Try to parse task JSON from accumulated text
        tryParseAndSaveTask(accumulatedText, userId, c.env.DB, server);
        accumulatedText = '';
      }
    } catch (e) {
      console.error('Error processing Gemini message:', e);
    }
  });

  geminiWs.addEventListener('close', () => {
    server.close(1000, 'Gemini връзката е затворена');
  });

  geminiWs.addEventListener('error', (e) => {
    console.error('Gemini WS error:', e);
    server.close(1011, 'Грешка в Gemini връзката');
  });

  // Handle messages from client
  server.addEventListener('message', (event) => {
    if (!geminiWs) return;

    try {
      const msg = JSON.parse(event.data as string);

      if (msg.type === 'audio') {
        // Forward audio to Gemini
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
    geminiWs?.close();
  });

  return new Response(null, { status: 101, webSocket: client });
});

// --- Helper functions ---

async function tryParseAndSaveTask(
  text: string,
  userId: string,
  db: D1Database,
  ws: WebSocket
): Promise<void> {
  // Try to extract JSON from the text
  const jsonMatch = text.match(/\{[\s\S]*"task"[\s\S]*\}/);
  if (!jsonMatch) return;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.task) return;

    const task = await createTask(db, {
      user_id: userId,
      content: parsed.task,
      emotion: parsed.emotion || 'neutral',
      priority: parsed.priority || 3,
      due_date: parsed.due_date || null,
      estimated_minutes: parsed.estimated_minutes || null,
    });

    ws.send(JSON.stringify({
      type: 'taskSaved',
      task,
    }));
  } catch (e) {
    // Not valid JSON yet, ignore
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
    ctx.waitUntil(handleCron(env));
  },
};
