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

const BRIEF_PROMPTS: Record<string, (taskList: string) => string> = {
  en: (list) =>
    `Here is the user's incomplete task list:\n${list}\n\nGive a brief evening review (up to 4 sentences): which up to 3 tasks should be priority for tomorrow and why. Address the user directly, no filler phrases.`,
  bg: (list) =>
    `Ето списък с незавършените задачи на потребителя:\n${list}\n\nНаправи кратък вечерен преглед на български (до 4 изречения): кои до 3 задачи да са приоритет за утре и защо. Обръщай се направо към потребителя, без уводни фрази.`,
  de: (list) =>
    `Hier ist die unvollständige Aufgabenliste des Nutzers:\n${list}\n\nGib eine kurze Abendübersicht (bis 4 Sätze) auf Deutsch: welche bis zu 3 Aufgaben morgen Priorität haben und warum. Sprich den Nutzer direkt an.`,
  es: (list) =>
    `Aquí está la lista de tareas incompletas del usuario:\n${list}\n\nHaz un breve repaso nocturno (hasta 4 frases) en español: cuáles hasta 3 tareas deberían ser prioridad para mañana y por qué. Habla directamente al usuario.`,
  fr: (list) =>
    `Voici la liste des tâches incomplètes de l'utilisateur:\n${list}\n\nFais un bref bilan du soir (jusqu'à 4 phrases) en français : quelles jusqu'à 3 tâches devraient être prioritaires demain et pourquoi. Adresse-toi directement à l'utilisateur.`,
  ru: (list) =>
    `Вот список незавершённых задач пользователя:\n${list}\n\nСделай краткий вечерний обзор (до 4 предложений) на русском: какие до 3 задач должны быть приоритетом на завтра и почему. Обращайся прямо к пользователю.`,
  ar: (list) =>
    `هذه قائمة المهام غير المكتملة للمستخدم:\n${list}\n\nقدّم مراجعة مسائية قصيرة (حتى 4 جمل) بالعربية: ما هي حتى 3 مهام يجب أن تكون أولوية للغد ولماذا. تحدث مباشرة إلى المستخدم.`,
  zh: (list) =>
    `以下是用户未完成的任务列表：\n${list}\n\n用中文做简短的晚间回顾（最多4句）：明天哪最多3项任务应优先处理，以及原因。直接对用户说话。`,
  hi: (list) =>
    `यहाँ उपयोगकर्ता की अधूरी कार्य सूची है:\n${list}\n\nहिंदी में संक्षिप्त शाम की समीक्षा दें (4 वाक्य तक): कल किन 3 कार्यों को प्राथमिकता देनी चाहिए और क्यों। सीधे उपयोगकर्ता से बात करें।`,
};

const TASK_LINE_LABELS: Record<string, { priority: string; due: string; none: string }> = {
  en: { priority: 'Priority', due: 'due', none: 'none' },
  bg: { priority: 'Приоритет', due: 'срок', none: 'няма' },
  de: { priority: 'Priorität', due: 'Frist', none: 'keine' },
  es: { priority: 'Prioridad', due: 'plazo', none: 'ninguno' },
  fr: { priority: 'Priorité', due: 'échéance', none: 'aucune' },
  ru: { priority: 'Приоритет', due: 'срок', none: 'нет' },
  ar: { priority: 'الأولوية', due: 'الموعد', none: 'لا يوجد' },
  zh: { priority: '优先级', due: '截止', none: '无' },
  hi: { priority: 'प्राथमिकता', due: 'समय', none: 'कोई नहीं' },
};

async function getUserLanguage(env: CronEnv, userId: string): Promise<string> {
  try {
    const raw = await env.SESSIONS.get(`profile:${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { language?: string };
      if (parsed.language) return parsed.language;
    }
  } catch {
    /* ignore */
  }
  return 'bg';
}

function formatTaskLine(task: Task, lang: string): string {
  const labels = TASK_LINE_LABELS[lang] || TASK_LINE_LABELS.en;
  const due = task.due_date
    ? `${labels.due}: ${task.due_date}${task.due_time ? ' ' + task.due_time : ''}`
    : labels.none;
  return `- [${labels.priority} ${task.priority}] ${task.content} (${due})`;
}

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

  const lang = await getUserLanguage(env, userId);
  const taskList = tasks
    .slice(0, MAX_TASKS_PER_PROMPT)
    .map((t) => formatTaskLine(t, lang))
    .join('\n');

  const buildPrompt = BRIEF_PROMPTS[lang] || BRIEF_PROMPTS.en;
  const prompt = buildPrompt(taskList);

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
