import { getAllIncompleteTasks, Task } from './tasks';

export interface CronEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GEMINI_API_KEY: string;
}

// Cost caps: one Gemini call per user per day, only when the task list changed,
// and never more than MAX_USERS_PER_RUN calls in a single cron run.
const MAX_USERS_PER_RUN = 50;
const MAX_TASKS_PER_PROMPT = 40;

export async function handleCron(env: CronEnv): Promise<void> {
  const tasks = await getAllIncompleteTasks(env.DB);
  if (tasks.length === 0) return;

  const byUser = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = byUser.get(task.user_id);
    if (list) list.push(task);
    else byUser.set(task.user_id, [task]);
  }

  let generated = 0;
  for (const [userId, userTasks] of byUser) {
    if (generated >= MAX_USERS_PER_RUN) break;
    try {
      if (await generateBriefForUser(env, userId, userTasks)) generated++;
    } catch (e) {
      console.error('Cron brief failed for user:', userId, e);
    }
  }
}

/** Generates an evening priority brief for one user and stores it in KV. */
async function generateBriefForUser(env: CronEnv, userId: string, tasks: Task[]): Promise<boolean> {
  const taskHash = tasks.map((t) => `${t.id}:${t.priority}:${t.due_date || ''}`).join(',');
  const hashKey = `cron:hash:${userId}`;
  if ((await env.SESSIONS.get(hashKey)) === taskHash) return false;

  const taskList = tasks
    .slice(0, MAX_TASKS_PER_PROMPT)
    .map((t) => `- [Приоритет ${t.priority}] ${t.content} (срок: ${t.due_date || 'няма'}${t.due_time ? ' ' + t.due_time : ''})`)
    .join('\n');

  const prompt = `Ето списък с незавършените задачи на потребителя:\n${taskList}\n\nНаправи кратък вечерен преглед на български (до 4 изречения): кои до 3 задачи да са приоритет за утре и защо. Обръщай се направо към потребителя, без уводни фрази.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 512,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('Cron Gemini request failed:', await response.text());
    return false;
  }

  const data = await response.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return false;

  await env.SESSIONS.put(
    `brief:${userId}`,
    JSON.stringify({ text: String(text).trim(), generated_at: new Date().toISOString() }),
    { expirationTtl: 2 * 86400 }
  );
  await env.SESSIONS.put(hashKey, taskHash, { expirationTtl: 7 * 86400 });
  return true;
}
