import { getAllIncompleteTasks, Task } from './tasks';

export interface CronEnv {
  DB: D1Database;
  GEMINI_API_KEY: string;
}

export async function handleCron(env: CronEnv): Promise<void> {
  const tasks = await getAllIncompleteTasks(env.DB);

  if (tasks.length === 0) return;

  const taskList = tasks
    .map((t: Task) => `- [Приоритет ${t.priority}] ${t.content} (краен срок: ${t.due_date || 'няма'})`)
    .join('\n');

  const prompt = `Ето списък с незавършени задачи:\n${taskList}\n\nКои 3 задачи трябва да бъдат приоритет за утре? Отговори на български като JSON масив с полета: task_id, reason.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
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
    // Future: send push notifications to users via app_token
  }
}
