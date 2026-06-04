import { getAllIncompleteTasks, Task } from './tasks';

export interface CronEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GEMINI_API_KEY: string;
}

export async function handleCron(env: CronEnv): Promise<void> {
  const tasks = await getAllIncompleteTasks(env.DB);

  if (tasks.length === 0) return;

  // Cache check: skip Gemini call if task list hasn't changed
  const taskHash = tasks.map((t: Task) => `${t.id}:${t.priority}`).join(',');
  const cacheKey = 'cron:last_task_hash';
  const lastHash = await env.SESSIONS.get(cacheKey);

  if (lastHash === taskHash) {
    console.log('Cron: задачите не са променени, пропускам Gemini заявка.');
    return;
  }

  const taskList = tasks
    .map((t: Task) => `- [id:${t.id}, Приоритет ${t.priority}] ${t.content} (краен срок: ${t.due_date || 'няма'})`)
    .join('\n');

  const prompt = `Ето списък с незавършени задачи:\n${taskList}\n\nКои 3 задачи трябва да бъдат приоритет за утре? Отговори на български като JSON масив с полета: task_id, reason.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 512,
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('Cron Gemini request failed:', await response.text());
    return;
  }

  const data = await response.json() as any;
  const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (resultText) {
    console.log('Evening priority review:', resultText);
    // Cache current task hash to avoid duplicate calls
    await env.SESSIONS.put(cacheKey, taskHash, { expirationTtl: 86400 });
    // Future: send push notifications to users via app_token
  }
}
