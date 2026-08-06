/**
 * KASY — AI Secretary (voice task assistant with calendar)
 */

const { API_BASE, LIVE_MODEL } = window.AIVA_CONFIG;
const { loadAssistantSettings, buildSessionInstructions } = window.AIVA_SETTINGS;

function t(key) {
  return window.AIVA_I18N?.t?.(key) ?? key;
}

function tf(key, vars) {
  return window.AIVA_I18N?.tf?.(key, vars) ?? t(key);
}

function getLocale() {
  return window.AIVA_I18N?.getLocale?.() ?? 'bg-BG';
}

function setRecordBtnLive(live) {
  recordBtn?.classList.toggle('live', live);
}

// --- User ID ---
function getUserId() {
  let id = localStorage.getItem('aiva_user_id');
  if (!id) {
    id = 'user_' + crypto.randomUUID();
    localStorage.setItem('aiva_user_id', id);
  }
  return id;
}

const userId = getUserId();

// --- DOM ---
const recordBtn = document.getElementById('recordBtn');
const statusEl = document.getElementById('status');
const waveform = document.getElementById('waveform');
const toast = document.getElementById('toast');
const toastContent = document.getElementById('toastContent');
const toastMeta = document.getElementById('toastMeta');
const errorToast = document.getElementById('errorToast');
const tasksContainer = document.getElementById('tasksContainer');
const tasksCount = document.getElementById('tasksCount');
const rangeLabel = document.getElementById('rangeLabel');
const prevRangeBtn = document.getElementById('prevRange');
const nextRangeBtn = document.getElementById('nextRange');
const todayBtn = document.getElementById('todayBtn');
const addTaskBtn = document.getElementById('addTaskBtn');
const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
const taskModal = document.getElementById('taskModal');
const taskForm = document.getElementById('taskForm');
const modalTitle = document.getElementById('modalTitle');
const closeTaskModalBtn = document.getElementById('closeTaskModal');
const deleteTaskBtn = document.getElementById('deleteTaskBtn');
const duplicateTaskBtn = document.getElementById('duplicateTaskBtn');
const addToCalendarBtn = document.getElementById('addToCalendarBtn');
const discussTaskBtn = document.getElementById('discussTaskBtn');
const duplicateRowsField = document.getElementById('duplicateRows');
const taskIdField = document.getElementById('taskId');
const upcomingStrip = document.getElementById('upcomingStrip');
const upcomingList = document.getElementById('upcomingList');
const upcomingCount = document.getElementById('upcomingCount');

// --- State ---
let client = null;
let audioStreamer = null;
let audioPlayer = null;
let isSessionActive = false;
let isConnecting = false;
let assistantSettings = loadAssistantSettings();

// Offline-first: render the last known task list instantly, then refresh from network
const TASKS_CACHE_KEY = 'aiva_tasks_cache';

function readCachedTasks() {
  try {
    const cached = JSON.parse(localStorage.getItem(TASKS_CACHE_KEY) || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch (_e) {
    return [];
  }
}

let tasks = readCachedTasks();
let externalEvents = [];
let currentDate = new Date();
let calendarView = assistantSettings.calendar.defaultView || 'day';
let weekFocusDate = new Date();
let touchStartX = null;
let calendarNavLock = false;
let voiceFocusTask = null;
let cachedCalendarEvents = [];
let assistantTranscriptBuffer = '';
let assistantTurnComplete = false;
let sessionEnding = false;
let sessionEndTimer = null;
let sessionEndFinalizing = false;
let lastAssistantAudioAt = 0;
let farewellEndRequestedAt = 0;
let farewellTurnCompleteReceived = false;
let userTranscriptBuffer = '';
let userGoodbyeTimer = null;
let awaitingGreetingMic = false;
let greetingMicTimer = null;
let reconnectAttempts = 0;
let resumingSession = false;
const MAX_RECONNECT_ATTEMPTS = 2;

function setMicUplinkMuted(muted) {
  audioStreamer?.setUplinkMuted(muted);
}

async function tryUnmuteMicAfterAssistant() {
  if (sessionEnding || !assistantTurnComplete || audioPlayer?.isPlaying) return;
  setMicUplinkMuted(false);
}

function onAssistantPlaybackStateChange(isPlaying) {
  if (isPlaying) {
    // При barge-in микрофонът остава отворен, докато асистентът говори —
    // ехото се маха от echoCancellation на capture потока, а сървърният VAD
    // праща INTERRUPTED при реално прекъсване от потребителя.
    if (!assistantSettings.bargeInEnabled || sessionEnding) {
      setMicUplinkMuted(true);
    }
    window.AIVA_HAPTICS?.touchSpeechSession?.();
    return;
  }
  if (sessionEnding) {
    tryFinalizeSessionEnd();
    return;
  }
  tryUnmuteMicAfterAssistant();
}

// --- Wake lock: екранът не гасне по време на гласова сесия (изгаснал екран
// суспендира WebView-то и убива микрофона тихо) ---
let wakeLock = null;

async function acquireWakeLock() {
  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (_e) {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release?.();
  } catch (_e) { /* ok */ }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  // ОС освобождава wake lock-а при скриване — при връщане го взимаме пак
  if (document.visibilityState === 'visible' && isSessionActive) acquireWakeLock();
});

// --- Тишина: ако моделът така и не извика end_session и никой не казва
// нищо, сесията не бива да виси с отворен микрофон безкрайно ---
const SESSION_IDLE_TIMEOUT_MS = 120000;
let sessionIdleTimer = null;

function clearSessionIdleTimer() {
  if (sessionIdleTimer) {
    clearTimeout(sessionIdleTimer);
    sessionIdleTimer = null;
  }
}

function touchSessionActivity() {
  if (!isSessionActive && !isConnecting) return;
  clearSessionIdleTimer();
  sessionIdleTimer = setTimeout(() => {
    sessionIdleTimer = null;
    if (isSessionActive && !sessionEnding) disconnectSession();
  }, SESSION_IDLE_TIMEOUT_MS);
}

// --- save_task tool (Gemini function declaration format) ---
class SaveTaskTool extends FunctionCallDefinition {
  constructor() {
    super(
      'save_task',
      'Запазва задача след като потребителят я опише. Извикай когато разбереш какво е задачата.',
      {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Кратка формулировка на задачата на български' },
          emotion: {
            type: 'string',
            description: 'Засечена емоция от тона',
            enum: ['stress', 'tired', 'urgent', 'neutral'],
          },
          priority: { type: 'integer', description: 'Приоритет 1 (висок) до 5 (нисък)' },
          due_date: { type: 'string', description: 'Дата YYYY-MM-DD или празно' },
          due_time: { type: 'string', description: 'Час HH:MM или празно' },
          estimated_minutes: { type: 'integer', description: 'Прогнозни минути' },
          notes: { type: 'string', description: 'Допълнителна информация или контекст' },
          location: { type: 'string', description: 'Локация, ако има' },
          repeat_rule: { type: 'string', description: 'Повторяемост като свободен текст, ако потребителят я поиска' },
          tags: { type: 'string', description: 'Тагове, разделени със запетая' },
        },
      },
      ['task', 'emotion', 'priority']
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- read_tasks tool ---
class ReadTasksTool extends FunctionCallDefinition {
  constructor() {
    super(
      'read_tasks',
      'Чете задачите на потребителя за определен период. Извикай когато потребителят поиска да чуе задачите си.',
      {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Период: today, tomorrow, week, all',
            enum: ['today', 'tomorrow', 'week', 'all'],
          },
          date: { type: 'string', description: 'Конкретна дата YYYY-MM-DD, ако потребителят посочи' },
        },
      },
      []
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- edit_task tool ---
class EditTaskTool extends FunctionCallDefinition {
  constructor() {
    super(
      'edit_task',
      'Редактира съществуваща задача. Извикай след като потребителят потвърди промяната.',
      {
        type: 'object',
        properties: {
          task_id: { type: 'integer', description: 'ID на задачата за редактиране' },
          search_text: { type: 'string', description: 'Текст за търсене на задачата, ако потребителят не знае ID' },
          content: { type: 'string', description: 'Нов текст на задачата' },
          due_date: { type: 'string', description: 'Нова дата YYYY-MM-DD' },
          due_time: { type: 'string', description: 'Нов час HH:MM' },
          priority: { type: 'integer', description: 'Нов приоритет 1-5' },
          notes: { type: 'string', description: 'Нови бележки' },
          location: { type: 'string', description: 'Нова локация' },
          tags: { type: 'string', description: 'Нови тагове' },
        },
      },
      []
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- delete_task tool ---
class DeleteTaskTool extends FunctionCallDefinition {
  constructor() {
    super(
      'delete_task',
      'Изтрива задача. САМО след потвърждение от потребителя!',
      {
        type: 'object',
        properties: {
          task_id: { type: 'integer', description: 'ID на задачата за изтриване' },
          search_text: { type: 'string', description: 'Текст за търсене на задачата, ако потребителят не знае ID' },
        },
      },
      []
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- mark_task_done tool ---
class MarkTaskDoneTool extends FunctionCallDefinition {
  constructor() {
    super(
      'mark_task_done',
      'Маркира задача като завършена.',
      {
        type: 'object',
        properties: {
          task_id: { type: 'integer', description: 'ID на задачата' },
          search_text: { type: 'string', description: 'Текст за търсене на задачата, ако потребителят не знае ID' },
        },
      },
      []
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- discuss_task tool ---
class DiscussTaskTool extends FunctionCallDefinition {
  constructor() {
    super(
      'discuss_task',
      'Обсъжда задача и дава съвети. Може да добави съвета като бележка към задачата.',
      {
        type: 'object',
        properties: {
          task_id: { type: 'integer', description: 'ID на задачата за обсъждане' },
          search_text: { type: 'string', description: 'Текст за търсене на задачата' },
          add_note: { type: 'boolean', description: 'Дали да добави съвета като бележка към задачата' },
          advice: { type: 'string', description: 'Съвет или информация за добавяне към задачата' },
        },
      },
      []
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- read_calendar_events tool ---
class ReadCalendarEventsTool extends FunctionCallDefinition {
  constructor() {
    super(
      'read_calendar_events',
      'Чете събития от избрания календар на устройството. Извикай когато потребителят поиска да чуе календарни събития.',
      {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Период: today, tomorrow, week, all',
            enum: ['today', 'tomorrow', 'week', 'all'],
          },
          date: { type: 'string', description: 'Конкретна дата YYYY-MM-DD' },
        },
      },
      []
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- edit_calendar_event tool ---
class EditCalendarEventTool extends FunctionCallDefinition {
  constructor() {
    super(
      'edit_calendar_event',
      'Редактира събитие от календара на устройството. Извикай след потвърждение от потребителя.',
      {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'ID на календарното събитие' },
          search_text: { type: 'string', description: 'Текст за търсене на събитието' },
          title: { type: 'string', description: 'Ново заглавие' },
          start_date: { type: 'string', description: 'Нова дата YYYY-MM-DD' },
          start_time: { type: 'string', description: 'Нов час HH:MM' },
          end_date: { type: 'string', description: 'Крайна дата YYYY-MM-DD' },
          end_time: { type: 'string', description: 'Краен час HH:MM' },
          location: { type: 'string', description: 'Нова локация' },
          description: { type: 'string', description: 'Ново описание' },
        },
      },
      []
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- delete_calendar_event tool ---
class DeleteCalendarEventTool extends FunctionCallDefinition {
  constructor() {
    super(
      'delete_calendar_event',
      'Изтрива събитие от календара на устройството. САМО след потвърждение!',
      {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'ID на календарното събитие' },
          search_text: { type: 'string', description: 'Текст за търсене на събитието' },
        },
      },
      []
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- end_session tool ---
class EndSessionTool extends FunctionCallDefinition {
  constructor() {
    super(
      'end_session',
      'Спира слушането и затваря гласовата сесия. ЗАДЪЛЖИТЕЛНО го извикай в същия ход, веднага след като произнесеш сбогуването — ти си единственият, който може да спре микрофона. Никога не го споменавай на глас.',
      {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Кратка причина за приключване' },
        },
      },
      []
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- Date helpers ---
function pad(value) {
  return String(value).padStart(2, '0');
}

function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseISODate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date, amount) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function startOfWeek(date) {
  const weekStartsOn = assistantSettings.calendar.weekStartsOn ?? 1;
  const start = new Date(date);
  const day = start.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  start.setDate(start.getDate() - diff);
  return start;
}

function sameDay(a, b) {
  return toISODate(a) === toISODate(b);
}

function formatDateShort(date) {
  return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(date);
}

function formatDateLong(date) {
  return new Intl.DateTimeFormat(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function formatMonth(date) {
  return new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(date);
}

function formatWeekdayShort(date) {
  return new Intl.DateTimeFormat(getLocale(), { weekday: 'short' }).format(date);
}

function getWeekdayHeaders() {
  const weekStartsOn = assistantSettings.calendar.weekStartsOn ?? 1;
  const ref = new Date(2024, 0, 7);
  const headers = [];
  for (let i = 0; i < 7; i++) {
    const dayIndex = (weekStartsOn + i) % 7;
    const d = new Date(ref);
    d.setDate(ref.getDate() + dayIndex);
    headers.push(formatWeekdayShort(d));
  }
  return headers;
}

function sortedTasks(items) {
  return [...items].sort((a, b) => {
    const dateA = a.due_date || '9999-12-31';
    const dateB = b.due_date || '9999-12-31';
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const timeA = a.due_time || '99:99';
    const timeB = b.due_time || '99:99';
    if (timeA !== timeB) return timeA.localeCompare(timeB);
    return (a.priority || 3) - (b.priority || 3);
  });
}

function syncProfileToServer() {
  if (!API_BASE || !userId) return;
  const lang = assistantSettings.profile?.language || 'bg';
  fetch(`${API_BASE}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, language: lang }),
  }).catch(() => {});
}

// --- UI helpers ---
function applyPreferences(options = {}) {
  assistantSettings = loadAssistantSettings();
  document.documentElement.style.setProperty('--accent', assistantSettings.appearance.accentColor);
  document.body.classList.toggle('compact-calendar', assistantSettings.appearance.compactCalendar);
  window.AIVA_I18N?.initFromSettings?.(assistantSettings);
  if (options.i18n !== false) {
    window.AIVA_I18N?.applyToDocument?.(document, assistantSettings.profile?.language);
  }
  if (!isSessionActive) {
    setStatus(t('tapToRecord'));
  }
  if (taskModal.classList.contains('visible')) {
    const task = taskIdField.value ? getTaskById(taskIdField.value) : null;
    modalTitle.textContent = task ? t('taskDetails') : t('newTask');
  }
}

function setStatus(text, active = false, mode = 'default') {
  statusEl.textContent = text;
  statusEl.classList.toggle('active', active);
  statusEl.classList.toggle('assistant-speech', mode === 'assistant');
}

function setAssistantSpeech(text) {
  // Транскрипцията тече винаги, но се показва само ако е включен текстовият изход.
  if (!assistantSettings.textOutputEnabled) return;
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  setStatus(trimmed, true, 'assistant');
}

// Край на разговора: основно end_session от модела; клиентът също следи
// сбогувания в транскрипцията и при нужда затваря (без фалшиви „благодаря" насред разговор).

function clearUserGoodbyeTimer() {
  if (userGoodbyeTimer) {
    clearTimeout(userGoodbyeTimer);
    userGoodbyeTimer = null;
  }
}

function maybeScheduleSessionEndFromFarewell(source) {
  if (sessionEnding || awaitingGreetingMic || !isSessionActive) return;
  const text = assistantTranscriptBuffer;
  if (!window.AIVA_SESSION_END?.looksLikeAssistantFarewell?.(text)) return;
  scheduleSessionEnd();
}

function handleUserGoodbyeTranscript(text, finished) {
  if (!finished || sessionEnding || awaitingGreetingMic || !isSessionActive) return;
  if (!window.AIVA_SESSION_END?.looksLikeUserGoodbye?.(text)) return;
  clearUserGoodbyeTimer();
  userGoodbyeTimer = setTimeout(() => {
    userGoodbyeTimer = null;
    if (!sessionEnding && isSessionActive) scheduleSessionEnd();
  }, USER_GOODBYE_END_MS);
}
function clearSessionEndState() {
  sessionEnding = false;
  sessionEndFinalizing = false;
  farewellEndRequestedAt = 0;
  farewellTurnCompleteReceived = false;
  clearUserGoodbyeTimer();
  userTranscriptBuffer = '';
  if (sessionEndTimer) {
    clearTimeout(sessionEndTimer);
    sessionEndTimer = null;
  }
}

function clearGreetingMicTimer() {
  if (greetingMicTimer) {
    clearTimeout(greetingMicTimer);
    greetingMicTimer = null;
  }
}

async function ensureMicStreaming() {
  if (!client || audioStreamer?.isStreaming) return;
  if (!audioStreamer) audioStreamer = new AudioStreamer(client);
  await audioStreamer.start();
}

function scheduleGreetingMicFallback(delayMs = 8000) {
  clearGreetingMicTimer();
  greetingMicTimer = setTimeout(async () => {
    greetingMicTimer = null;
    if (!awaitingGreetingMic || !isSessionActive) return;
    awaitingGreetingMic = false;
    try {
      await ensureMicStreaming();
    } catch (e) {
      console.error('Greeting mic fallback failed:', e);
      showError(t('errMicrophone'));
      disconnectSession();
    }
  }, delayMs);
}

async function startMicAfterGreeting() {
  if (!awaitingGreetingMic || !isSessionActive) return;
  awaitingGreetingMic = false;
  clearGreetingMicTimer();
  if (audioPlayer) {
    await audioPlayer.waitForDrain(4000);
  }
  try {
    await ensureMicStreaming();
  } catch (e) {
    console.error('Mic start after greeting failed:', e);
    showError(t('errMicrophone'));
    disconnectSession();
  }
}

const SESSION_END_FALLBACK_MS = 15000;
const FAREWELL_AUDIO_GAP_MS = 450;
const FAREWELL_PLAYBACK_STABLE_MS = 400;
const USER_GOODBYE_END_MS = 8000;

function armSessionEnd() {
  if (sessionEnding) return;
  sessionEnding = true;
  // Само заглушаваме uplink-а. Спирането на микрофона (audioStreamer.stop)
  // затваря capture AudioContext-а и Android превключва аудио маршрута
  // насред прощалната реплика — гласът насича/глъхне. Реалното спиране
  // става в disconnectSession, след като аудиото дозвучи.
  setMicUplinkMuted(true);
}

function finishSessionEndUi() {
  waveform.classList.remove('active');
  recordBtn.classList.remove('recording');
  setRecordBtnLive(false);
  statusEl?.classList.remove('assistant-speech');
}

function clearSessionEndFallback() {
  if (sessionEndTimer) {
    clearTimeout(sessionEndTimer);
    sessionEndTimer = null;
  }
}

function scheduleSessionEndFallback() {
  clearSessionEndFallback();
  sessionEndTimer = setTimeout(() => {
    sessionEndTimer = null;
    finalizeSessionEnd();
  }, SESSION_END_FALLBACK_MS);
}

function isFarewellAudioPending() {
  if (!audioPlayer) return false;
  if (audioPlayer.isPlaying) return true;
  const endMs = audioPlayer.getScheduledPlaybackEndMs?.() || 0;
  if (endMs > performance.now() + 80) return true;
  // TTS пристига на порции — между chunk-овете има кратки паузи
  if (performance.now() - lastAssistantAudioAt < FAREWELL_AUDIO_GAP_MS) return true;
  return false;
}

async function waitForFarewellPlaybackIdle(timeoutMs = 30000) {
  const deadline = performance.now() + timeoutMs;
  let stableSince = 0;

  while (performance.now() < deadline) {
    if (!isFarewellAudioPending()) {
      if (!stableSince) stableSince = performance.now();
      if (performance.now() - stableSince >= FAREWELL_PLAYBACK_STABLE_MS) return;
    } else {
      stableSince = 0;
      if (audioPlayer) {
        await audioPlayer.waitForDrain(Math.max(500, deadline - performance.now()));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

function tryFinalizeSessionEnd() {
  if (!sessionEnding || sessionEndFinalizing) return;

  const audioPending = isFarewellAudioPending();
  const waitedMs = farewellEndRequestedAt
    ? performance.now() - farewellEndRequestedAt
    : 0;

  if (farewellTurnCompleteReceived && !audioPending) {
    finalizeSessionEnd();
    return;
  }

  // end_session преди farewell audio: чакаме TURN_COMPLETE и/или аудио
  if (!audioPending && waitedMs > 600 && !farewellTurnCompleteReceived) {
    finalizeSessionEnd();
    return;
  }

  scheduleSessionEndFallback();
}

async function finalizeSessionEnd() {
  if (sessionEndFinalizing) return;
  sessionEndFinalizing = true;
  clearSessionEndFallback();
  try {
    await waitForFarewellPlaybackIdle(30000);
    finishSessionEndUi();
    window.AIVA_HAPTICS?.endSpeechSession?.();
    if (isSessionActive) disconnectSession();
  } finally {
    sessionEndFinalizing = false;
  }
}

/**
 * Извиква се от end_session tool call-а на асистента. Uplink-ът се заглушава
 * веднага, а микрофонът и сесията се затварят чак след като сбогуването
 * дозвучи — вж. finalizeSessionEnd.
 */
function scheduleSessionEnd() {
  farewellEndRequestedAt = performance.now();
  if (!sessionEnding) {
    armSessionEnd();
  }
  // Ако end_session пристигне преди farewell audio, assistantTurnComplete
  // може още да е true от предишния ход — не финализираме докато не дойде
  // TURN_COMPLETE на текущия сбогуствен ход или аудиото дозвучи.
  if (!farewellTurnCompleteReceived) {
    assistantTurnComplete = false;
  }
  tryFinalizeSessionEnd();
}

/**
 * WS падна. При нормален край или неактивна сесия — обичайното затваряне;
 * при жива сесия — до MAX_RECONNECT_ATTEMPTS опита за възстановяване със
 * session resumption handle (контекстът на разговора се запазва).
 */
async function handleSocketClose() {
  if (!isSessionActive) {
    // WS затворен още преди SETUP_COMPLETE (отхвърлен setup, лош токен) —
    // иначе UI остава завинаги на „Свързване…"
    if (isConnecting) {
      showError(t('errConnect'));
      disconnectSession();
    }
    return;
  }
  if (sessionEnding) {
    // Сървърът често затваря WS веднага след end_session — не спираме
    // capture-а тук, а чакаме сбогуването да дозвучи преди disconnect.
    tryFinalizeSessionEnd();
    return;
  }
  if (!client || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    showError(t('errConnect'));
    disconnectSession();
    return;
  }
  reconnectAttempts += 1;
  resumingSession = true;
  setStatus(t('connecting'), true);
  await new Promise((resolve) => setTimeout(resolve, 700 * reconnectAttempts));
  if (!isSessionActive || sessionEnding || !client) return;
  try {
    client.updateToken(await fetchToken());
    client.connect();
  } catch (e) {
    console.error('Reconnect failed:', e);
    showError(t('errConnect'));
    disconnectSession();
  }
}

let errorToastTimer = null;
function showError(msg) {
  errorToast.textContent = msg;
  errorToast.classList.add('visible');
  if (errorToastTimer) clearTimeout(errorToastTimer);
  errorToastTimer = setTimeout(() => {
    errorToastTimer = null;
    errorToast.classList.remove('visible');
  }, 5000);
}

window.showCalendarSyncToast = function showCalendarSyncToast(task) {
  showToast({
    content: task?.content ? tf('toastCalendarArrow', { content: task.content }) : t('toastAddedCalendar'),
    emotion: 'neutral',
    priority: 3,
  });
};

function showToast(task) {
  toastContent.textContent = task.content;
  const emotionMap = { stress: '😰', tired: '😴', urgent: '⚡', neutral: '😊' };
  toastMeta.innerHTML = `
    <span>${emotionMap[task.emotion] || '😊'} ${escapeHtml(task.emotion || 'neutral')}</span>
    <span>⚡ ${escapeHtml(`P${task.priority}`)}</span>
    ${task.due_date ? `<span>📅 ${escapeHtml(task.due_date)}</span>` : ''}
    ${task.due_time ? `<span>🕘 ${escapeHtml(task.due_time)}</span>` : ''}
  `;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 5000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function getTaskDateTime(task) {
  if (!task?.due_date) return null;
  const [year, month, day] = task.due_date.split('-').map(Number);
  let hours = 9;
  let minutes = 0;
  if (task.due_time) {
    [hours, minutes] = task.due_time.split(':').map(Number);
  }
  return new Date(year, month - 1, day, hours, minutes);
}

function isTaskOverdue(task) {
  const dt = getTaskDateTime(task);
  if (!dt) return false;
  return dt < new Date();
}

function getTaskCountdown(task) {
  const dt = getTaskDateTime(task);
  if (!dt || !window.AIVA_NOTIFIER?.formatCountdown) return '';
  return window.AIVA_NOTIFIER.formatCountdown(dt.getTime() - Date.now());
}

function renderUpcomingStrip() {
  if (!upcomingStrip || !upcomingList) return;
  const show = assistantSettings.notifications?.showUpcomingStrip !== false;
  if (!show || !window.AIVA_NOTIFIER?.getUpcomingTasks) {
    upcomingStrip.hidden = true;
    return;
  }

  const upcoming = window.AIVA_NOTIFIER.getUpcomingTasks(tasks, 24).slice(0, 5);
  if (!upcoming.length) {
    upcomingStrip.hidden = true;
    return;
  }

  upcomingStrip.hidden = false;
  upcomingCount.textContent = String(upcoming.length);

  upcomingList.innerHTML = upcoming.map(({ task, msUntil }) => {
    const overdue = msUntil < 0;
    const countdown = window.AIVA_NOTIFIER.formatCountdown(msUntil);
    return `
      <div class="upcoming-item ${overdue ? 'is-overdue' : ''}" data-id="${task.id}" tabindex="0">
        <div class="upcoming-time">${escapeHtml(task.due_time || '—')}</div>
        <div class="upcoming-body">
          <div class="upcoming-title">${escapeHtml(task.content)}</div>
          <div class="upcoming-countdown">${escapeHtml(countdown)}</div>
        </div>
        <div class="upcoming-actions">
          <button class="upcoming-action-btn" data-action="snooze" data-id="${task.id}" type="button" title="${escapeHtml(t('snooze10'))}">⏰</button>
          <button class="upcoming-action-btn" data-action="done" data-id="${task.id}" type="button" title="${escapeHtml(t('doneAction'))}">✓</button>
        </div>
      </div>
    `;
  }).join('');
}

function taskMeta(task) {
  const meta = [];
  if (task.due_time) meta.push(task.due_time);
  if (task.estimated_minutes) meta.push(`${task.estimated_minutes} ${t('minsShort')}`);
  if (task.location) meta.push(task.location);
  if (task.tags) meta.push(task.tags);
  return meta;
}

function renderTaskCard(task, mode = 'agenda') {
  const meta = taskMeta(task);
  const overdue = isTaskOverdue(task);
  const countdown = getTaskCountdown(task);
  const taskDt = getTaskDateTime(task);
  const msUntil = taskDt ? taskDt.getTime() - Date.now() : Infinity;
  const synced = window.AIVA_NATIVE_CALENDAR?.isTaskSynced?.(task.id);
  const statusClass = overdue ? 'is-overdue' : (msUntil > 0 && msUntil <= 3600000 ? 'is-upcoming' : '');

  return `
    <article class="task-item task-card task-${escapeHtml(task.emotion || 'neutral')} ${statusClass}${task.isExternal ? ' external-event' : ''}" data-id="${task.id}"${task.isExternal ? ' data-external="true"' : ''} tabindex="0">
      <button class="task-check" data-id="${task.id}" aria-label="${escapeHtml(t('markComplete'))}" type="button">
        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <div class="task-body">
        <div class="task-row">
          <div class="task-text">${escapeHtml(task.content)}</div>
          <span class="priority-pill">P${escapeHtml(task.priority || 3)}</span>
          ${synced ? '<span class="calendar-badge">📅</span>' : ''}
        </div>
        <div class="task-info">
          ${task.due_date && mode !== 'month' ? `<span>${escapeHtml(task.due_date)}</span>` : ''}
          ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
          ${countdown ? `<span class="task-countdown">${escapeHtml(countdown)}</span>` : ''}
          ${task.repeat_rule ? `<span>↻ ${escapeHtml(task.repeat_rule)}</span>` : ''}
        </div>
        ${task.notes ? `<div class="task-note">${escapeHtml(task.notes)}</div>` : ''}
      </div>
    </article>
  `;
}

function tasksForDate(date) {
  const iso = toISODate(date);
  const local = tasks.filter((task) => task.due_date === iso);
  const external = externalEvents.filter((ev) => ev.due_date === iso);
  return sortedTasks([...local, ...external]);
}

function unscheduledTasks() {
  return sortedTasks(tasks.filter((task) => !task.due_date));
}

function setActiveViewButton() {
  viewButtons.forEach((button) => {
    const active = button.dataset.view === calendarView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-selected', String(active));
  });
}

function updateTodayChipVisibility() {
  if (!todayBtn) return;
  const showTodayChip = !(calendarView === 'day' && sameDay(currentDate, new Date()));
  todayBtn.classList.toggle('is-hidden', !showTodayChip);
}

function renderDaySection(date) {
  const dayTasks = tasksForDate(date);
  const isToday = sameDay(date, new Date());

  return `
    <section class="calendar-day ${isToday ? 'is-today' : ''}">
      <div class="day-header">
        <div class="day-header-main">
          <span class="day-name">${escapeHtml(formatWeekdayShort(date))}</span>
          <strong class="day-date">${escapeHtml(formatDateShort(date))}</strong>
        </div>
        <span class="day-count" aria-label="${dayTasks.length}">${dayTasks.length}</span>
      </div>
      <div class="day-stack">
        ${dayTasks.length ? dayTasks.map((task) => renderTaskCard(task)).join('') : `<div class="empty-state small">${escapeHtml(t('noTasksThisDay'))}</div>`}
      </div>
    </section>
  `;
}

function renderUnscheduledBlock() {
  const unscheduled = assistantSettings.calendar.showUnscheduled ? unscheduledTasks() : [];
  if (!unscheduled.length) return '';

  return `
    <section class="unscheduled-block">
      <div class="day-header">
        <strong>${escapeHtml(t('unscheduled'))}</strong>
        <span class="day-count">${unscheduled.length}</span>
      </div>
      <div class="day-stack">${unscheduled.map((task) => renderTaskCard(task)).join('')}</div>
    </section>
  `;
}

function renderWeekStrip(days) {
  return `
    <div class="week-strip" role="tablist" aria-label="${escapeHtml(t('calendarViewsAria'))}">
      ${days
        .map((date) => {
          const dayTasks = tasksForDate(date);
          const selected = sameDay(date, weekFocusDate);
          const isToday = sameDay(date, new Date());
          return `
            <button
              class="week-day-btn ${selected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}"
              data-date="${toISODate(date)}"
              type="button"
              role="tab"
              aria-selected="${selected}"
            >
              <span class="week-day-name">${escapeHtml(formatWeekdayShort(date))}</span>
              <span class="week-day-num">${date.getDate()}</span>
              ${dayTasks.length ? '<span class="week-day-dot" aria-hidden="true"></span>' : ''}
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function updateRangeLabel(dates) {
  if (calendarView === 'day') {
    rangeLabel.textContent = sameDay(currentDate, new Date()) ? `${t('todayPrefix')} · ${formatDateLong(currentDate)}` : formatDateLong(currentDate);
  } else if (calendarView === 'three') {
    rangeLabel.textContent = `${formatDateShort(dates[0])} - ${formatDateShort(dates[2])}`;
  } else if (calendarView === 'week') {
    rangeLabel.textContent = `${t('weekPrefix')} · ${formatDateShort(dates[0])} - ${formatDateShort(dates[6])}`;
  } else {
    rangeLabel.textContent = formatMonth(currentDate);
  }
}

function paintTasksContainer(html) {
  tasksContainer.innerHTML = html;
  calendarNavLock = false;
}

function renderAgendaView(dates, renderOpts = {}) {
  updateRangeLabel(dates);
  updateTodayChipVisibility();

  paintTasksContainer(`
    <div class="agenda-grid view-${calendarView}">
      ${dates.map((date) => renderDaySection(date)).join('')}
    </div>
    ${renderUnscheduledBlock()}
  `, renderOpts);
}

function renderWeekView(days, renderOpts = {}) {
  if (!days.some((date) => sameDay(date, weekFocusDate))) {
    weekFocusDate = days.find((date) => sameDay(date, new Date())) || days[0];
  }

  updateRangeLabel(days);
  updateTodayChipVisibility();

  const focusTasks = tasksForDate(weekFocusDate);
  paintTasksContainer(`
    ${renderWeekStrip(days)}
    <section class="calendar-day week-focus-day ${sameDay(weekFocusDate, new Date()) ? 'is-today' : ''}">
      <div class="day-header">
        <div class="day-header-main">
          <span class="day-name">${escapeHtml(formatWeekdayShort(weekFocusDate))}</span>
          <strong class="day-date">${escapeHtml(formatDateLong(weekFocusDate))}</strong>
        </div>
        <span class="day-count">${focusTasks.length}</span>
      </div>
      <div class="day-stack">
        ${focusTasks.length ? focusTasks.map((task) => renderTaskCard(task)).join('') : `<div class="empty-state small">${escapeHtml(t('noTasksThisDay'))}</div>`}
      </div>
    </section>
    ${renderUnscheduledBlock()}
  `, renderOpts);
}

function renderMonthView(renderOpts = {}) {
  const firstOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  updateRangeLabel(days);
  updateTodayChipVisibility();

  const selectedTasks = tasksForDate(currentDate);
  paintTasksContainer(`
    <div class="month-shell">
      <div class="month-grid">
        ${getWeekdayHeaders().map((day) => `<div class="month-weekday">${escapeHtml(day)}</div>`).join('')}
        ${days
          .map((date) => {
            const dayTasks = tasksForDate(date);
            const inMonth = date.getMonth() === currentDate.getMonth();
            const isToday = sameDay(date, new Date());
            const isSelected = sameDay(date, currentDate);
            return `
              <button
                class="month-cell ${inMonth ? '' : 'muted'} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}"
                data-date="${toISODate(date)}"
                type="button"
                aria-pressed="${isSelected}"
              >
                <span class="month-date">${date.getDate()}</span>
                <span class="month-dots">
                  ${dayTasks.slice(0, 4).map((task) => `<i class="dot priority-${escapeHtml(task.priority || 3)}"></i>`).join('')}
                </span>
                ${dayTasks.length ? `<span class="month-count">${dayTasks.length}</span>` : ''}
              </button>
            `;
          })
          .join('')}
      </div>
      <section class="month-agenda">
        <div class="day-header">
          <div class="day-header-main">
            <span class="day-name">${escapeHtml(formatWeekdayShort(currentDate))}</span>
            <strong class="day-date">${escapeHtml(formatDateLong(currentDate))}</strong>
          </div>
          <span class="day-count">${selectedTasks.length}</span>
        </div>
        <div class="day-stack">
          ${
            selectedTasks.length
              ? selectedTasks.map((task) => renderTaskCard(task, 'month')).join('')
              : `<div class="empty-state small">${escapeHtml(t('pickDayOrAdd'))}</div>`
          }
        </div>
      </section>
    </div>
  `, renderOpts);
}

function renderCalendar(renderOpts = {}) {
  setActiveViewButton();
  tasksCount.textContent = tasks.length;
  renderUpcomingStrip();

  if (calendarView === 'day') {
    renderAgendaView([currentDate], renderOpts);
  } else if (calendarView === 'three') {
    renderAgendaView([currentDate, addDays(currentDate, 1), addDays(currentDate, 2)], renderOpts);
  } else if (calendarView === 'week') {
    const start = startOfWeek(currentDate);
    renderWeekView(Array.from({ length: 7 }, (_, index) => addDays(start, index)), renderOpts);
  } else {
    renderMonthView(renderOpts);
  }
}

async function moveCalendar(direction) {
  if (calendarNavLock) return;
  calendarNavLock = true;

  if (calendarView === 'day') {
    currentDate = addDays(currentDate, direction);
  } else if (calendarView === 'three') {
    currentDate = addDays(currentDate, direction * 3);
  } else if (calendarView === 'week') {
    currentDate = addDays(currentDate, direction * 7);
    weekFocusDate = addDays(weekFocusDate, direction * 7);
  } else {
    currentDate = addMonths(currentDate, direction);
  }
  await fetchExternalEvents();
  renderCalendar();
}

// --- Tasks API ---
async function parseJsonResponse(res, fallbackMessage) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const preview = (await res.text()).trim().slice(0, 80);
    throw new Error(
      preview.startsWith('<!')
        ? t('errApiHtml')
        : fallbackMessage || tf('errInvalidResponse', { status: res.status })
    );
  }
  return res.json();
}

function findTaskBySearch(searchText) {
  if (!searchText) return null;
  const lower = searchText.toLowerCase().trim();
  const exact = tasks.find((t) => t.content.toLowerCase() === lower);
  if (exact) return exact;
  const partial = tasks.filter((t) => t.content.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    return partial.sort((a, b) => a.content.length - b.content.length)[0];
  }
  const words = lower.split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return null;
  let best = null;
  let bestScore = 0;
  for (const task of tasks) {
    const content = task.content.toLowerCase();
    const score = words.reduce((sum, word) => sum + (content.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = task;
    }
  }
  return bestScore > 0 ? best : null;
}

async function resolveTaskId(args) {
  if (args.task_id) return args.task_id;
  if (args.search_text) {
    const found = findTaskBySearch(args.search_text);
    if (found) return found.id;

    try {
      const res = await fetch(
        `${API_BASE}/api/tasks/${encodeURIComponent(userId)}/search?q=${encodeURIComponent(args.search_text)}`
      );
      if (res.ok) {
        const data = await parseJsonResponse(res, 'Грешка при търсене на задача');
        if (data.tasks?.length) return data.tasks[0].id;
      }
    } catch (e) {
      console.warn('resolveTaskId search:', e);
    }
    return null;
  }
  return null;
}

function buildTasksContextForAssistant() {
  if (!tasks.length) {
    return '\n\nТЕКУЩИ ЗАДАЧИ: няма активни задачи.';
  }

  let overdueCount = 0;
  const lines = tasks.slice(0, 60).map((task) => {
    const parts = [`ID ${task.id}: "${task.content}"`];
    if (task.due_date) parts.push(`дата ${task.due_date}`);
    if (task.due_time) parts.push(`час ${task.due_time}`);
    if (task.priority) parts.push(`приоритет ${task.priority}`);
    if (task.notes) parts.push(`бележки: ${String(task.notes).slice(0, 120)}`);
    if (isTaskOverdue(task)) {
      overdueCount++;
      parts.push('⚠ ПРОСРОЧЕНА');
    }
    return `- ${parts.join(', ')}`;
  });

  let context = `\n\nТЕКУЩИ ЗАДАЧИ НА ПОТРЕБИТЕЛЯ (${tasks.length}):\n${lines.join('\n')}\n\nПри редакция, изтриване или обсъждане използвай task_id от списъка. Ако потребителят спомене задача по име, намери най-близкото съвпадение.`;
  if (overdueCount > 0) {
    context += `\n\nИма ${overdueCount} просрочени задачи (маркирани с ⚠). При подходящ момент в разговора предложи веднъж да ги преместим за друг ден — кратко, без да настояваш.`;
  }
  return context;
}

async function loadCalendarEventsForAssistant() {
  cachedCalendarEvents = [];
  const crud = window.AIVA_CALENDAR_CRUD;
  if (!crud?.isAndroid?.() || !crud.getSelectedCalendarId()) {
    return [];
  }

  const today = toISODate(new Date());
  const end = toISODate(addDays(new Date(), 14));
  try {
    const { events = [] } = await crud.readAivaEvents({ from: today, to: end });
    cachedCalendarEvents = events;
    return events;
  } catch (e) {
    console.warn('loadCalendarEventsForAssistant:', e);
    return [];
  }
}

function buildCalendarContextForAssistant(events) {
  if (!window.AIVA_CALENDAR_CRUD?.getSelectedCalendarId?.()) {
    return '\n\nКАЛЕНДАР НА УСТРОЙСТВОТО: няма избран локален календар.';
  }
  if (!events.length) {
    return '\n\nКАЛЕНДАРНИ СЪБИТИЯ (устройство): няма събития в избрания календар за следващите 2 седмици.';
  }

  const lines = events.slice(0, 40).map((event) => {
    const eventId = event.eventId || event.id;
    const title = event.title || event.summary || 'Събитие';
    const when = event.startDate ? event.startDate.replace('T', ' ').slice(0, 16) : '';
    return `- event_id ${eventId}: "${title}" на ${when}`;
  });

  return `\n\nКАЛЕНДАРНИ СЪБИТИЯ В ИЗБРАНИЯ КАЛЕНДАР (${events.length}):\n${lines.join('\n')}\n\nТова са събития от календара на устройството. За тях използвай read_calendar_events / edit_calendar_event / delete_calendar_event.`;
}

function findCalendarEventBySearch(searchText) {
  if (!searchText) return null;
  const lower = searchText.toLowerCase().trim();
  const exact = cachedCalendarEvents.find((event) =>
    String(event.title || event.summary || '').toLowerCase() === lower
  );
  if (exact) return exact;

  const partial = cachedCalendarEvents.filter((event) =>
    String(event.title || event.summary || '').toLowerCase().includes(lower)
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    return partial.sort((a, b) =>
      String(a.title || a.summary || '').length - String(b.title || b.summary || '').length
    )[0];
  }
  return null;
}

function resolveCalendarEventId(args) {
  if (args.event_id) return String(args.event_id);
  if (args.search_text) {
    const found = findCalendarEventBySearch(args.search_text);
    if (found) return String(found.eventId || found.id || '');
  }
  return '';
}

function filterCalendarEvents(events, period, date) {
  if (date) {
    return events.filter((event) => event.startDate?.startsWith(date));
  }
  const today = toISODate(new Date());
  if (period === 'today') {
    return events.filter((event) => event.startDate?.startsWith(today));
  }
  if (period === 'tomorrow') {
    const tomorrow = toISODate(addDays(new Date(), 1));
    return events.filter((event) => event.startDate?.startsWith(tomorrow));
  }
  if (period === 'week') {
    const weekEnd = toISODate(addDays(new Date(), 7));
    return events.filter((event) => {
      const day = event.startDate?.slice(0, 10);
      return day && day >= today && day <= weekEnd;
    });
  }
  return events;
}

function formatCalendarEventSummary(event, index) {
  const when = event.startDate ? event.startDate.replace('T', ' ').slice(0, 16) : '';
  return `${index + 1}. ${event.title || event.summary || 'Събитие'} (${when})`;
}

async function handleVoiceReadCalendarEvents(args) {
  const events = cachedCalendarEvents.length
    ? cachedCalendarEvents
    : await loadCalendarEventsForAssistant();
  const filtered = filterCalendarEvents(events, args.period || 'today', args.date);
  if (!filtered.length) {
    return { success: true, message: 'Няма календарни събития за този период.', events: [] };
  }
  const summary = filtered.map((event, index) => formatCalendarEventSummary(event, index)).join('; ');
  return {
    success: true,
    count: filtered.length,
    summary,
    events: filtered.map((event) => ({
      event_id: String(event.eventId || event.id || ''),
      title: event.title || event.summary || 'Събитие',
      start: event.startDate || null,
      end: event.endDate || null,
    })),
  };
}

function buildCalendarEventFields(args, existing) {
  const fields = {};
  if (args.title) fields.title = args.title;
  if (args.location) fields.location = args.location;
  if (args.description) fields.description = args.description;

  const startDate = args.start_date || existing?.startDate?.slice(0, 10);
  const startTime = args.start_time || existing?.startDate?.slice(11, 16) || '09:00';
  if (startDate) fields.startDate = `${startDate}T${startTime}:00`;

  const endDate = args.end_date || existing?.endDate?.slice(0, 10) || startDate;
  const endTime = args.end_time || existing?.endDate?.slice(11, 16) || startTime;
  if (endDate) fields.endDate = `${endDate}T${endTime}:00`;

  return fields;
}

async function handleVoiceEditCalendarEvent(args) {
  const crud = window.AIVA_CALENDAR_CRUD;
  if (!crud?.isAndroid?.() || !crud.getSelectedCalendarId()) {
    return { error: 'Няма избран локален календар на устройството.' };
  }

  const eventId = resolveCalendarEventId(args);
  if (!eventId) {
    return { error: 'Не намерих събитие с това описание. Уточни кое събитие.' };
  }

  const existing = cachedCalendarEvents.find((event) => String(event.eventId || event.id) === eventId);
  const fields = buildCalendarEventFields(args, existing);
  if (!Object.keys(fields).length) {
    return { error: 'Няма какво да се промени. Кажи какво да обновя.' };
  }

  await crud.updateExternalEvent(eventId, fields);
  await loadCalendarEventsForAssistant();
  await refreshExternalEvents();
  return {
    success: true,
    event_id: eventId,
    message: 'Календарното събитие е обновено.',
  };
}

async function handleVoiceDeleteCalendarEvent(args) {
  const crud = window.AIVA_CALENDAR_CRUD;
  if (!crud?.isAndroid?.() || !crud.getSelectedCalendarId()) {
    return { error: 'Няма избран локален календар на устройството.' };
  }

  const eventId = resolveCalendarEventId(args);
  if (!eventId) {
    return { error: 'Не намерих събитие с това описание.' };
  }

  await crud.deleteExternalEvent(eventId);
  await loadCalendarEventsForAssistant();
  await refreshExternalEvents();
  return { success: true, event_id: eventId, message: 'Календарното събитие е изтрито.' };
}

function readTasksForPeriod(period, date) {
  const today = toISODate(new Date());
  let filtered;

  if (date) {
    filtered = tasks.filter((t) => t.due_date === date);
  } else if (period === 'today') {
    filtered = tasks.filter((t) => t.due_date === today);
  } else if (period === 'tomorrow') {
    const tomorrow = toISODate(addDays(new Date(), 1));
    filtered = tasks.filter((t) => t.due_date === tomorrow);
  } else if (period === 'week') {
    const weekEnd = toISODate(addDays(new Date(), 7));
    filtered = tasks.filter((t) => t.due_date && t.due_date >= today && t.due_date <= weekEnd);
  } else {
    filtered = tasks;
  }

  return sortedTasks(filtered);
}

async function handleVoiceReadTasks(args) {
  const result = readTasksForPeriod(args.period || 'today', args.date);
  if (!result.length) {
    return { success: true, message: 'Няма задачи за този период.', tasks: [] };
  }
  const summary = result.map((t, i) =>
    `${i + 1}. ${t.content} (приоритет ${t.priority}${t.due_time ? ', ' + t.due_time : ''}${t.location ? ', ' + t.location : ''})`
  ).join('; ');
  return { success: true, count: result.length, summary, tasks: result.map((t) => ({ id: t.id, content: t.content, priority: t.priority, due_date: t.due_date, due_time: t.due_time })) };
}

async function handleVoiceEditTask(args) {
  const taskId = await resolveTaskId(args);
  if (!taskId) return { error: 'Не намерих задача с това описание. Уточни коя задача.' };

  const updates = {};
  if (args.content) updates.content = args.content;
  if (args.due_date) updates.due_date = args.due_date;
  if (args.due_time) updates.due_time = args.due_time;
  if (args.priority) updates.priority = args.priority;
  if (args.notes) updates.notes = args.notes;
  if (args.location) updates.location = args.location;
  if (args.tags) updates.tags = args.tags;

  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, ...updates }),
  });
  const data = await res.json();
  if (!res.ok) return { error: data.error || 'Грешка при редакция' };
  await loadTasks();
  showToast(data.task);
  return { success: true, task_id: taskId, content: data.task.content, message: 'Задачата е редактирана.' };
}

// Undo за гласово изтриване — гласовото разпознаване греши, затова пазим
// копие на задачата и даваме 8 секунди за връщане.
let undoToastEl = null;
let undoToastTimer = null;

function hideUndoToast() {
  if (undoToastTimer) {
    clearTimeout(undoToastTimer);
    undoToastTimer = null;
  }
  undoToastEl?.remove();
  undoToastEl = null;
}

function showUndoToast(deletedTask) {
  hideUndoToast();

  undoToastEl = document.createElement('div');
  undoToastEl.className = 'undo-toast';

  const label = document.createElement('span');
  label.textContent = `${t('undoDeleted')}: ${String(deletedTask.content).slice(0, 40)}`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = t('undoAction');
  btn.addEventListener('click', async () => {
    hideUndoToast();
    try {
      await persistTask({
        task: deletedTask.content,
        emotion: deletedTask.emotion,
        priority: deletedTask.priority,
        due_date: deletedTask.due_date,
        due_time: deletedTask.due_time,
        estimated_minutes: deletedTask.estimated_minutes,
        notes: deletedTask.notes,
        location: deletedTask.location,
        repeat_rule: deletedTask.repeat_rule,
        tags: deletedTask.tags,
      });
      showToast({ content: t('undoRestored'), emotion: 'neutral', priority: 3 });
    } catch (e) {
      showError(e.message || t('errSave'));
    }
  });

  undoToastEl.append(label, btn);
  document.body.appendChild(undoToastEl);
  undoToastTimer = setTimeout(hideUndoToast, 8000);
}

async function handleVoiceDeleteTask(args) {
  const taskId = await resolveTaskId(args);
  if (!taskId) return { error: 'Не намерих задача с това описание.' };

  const snapshot = getTaskById(taskId);
  try {
    await removeTask(taskId);
    if (snapshot) showUndoToast(snapshot);
    return { success: true, task_id: taskId, message: 'Задачата е изтрита.' };
  } catch (e) {
    return { error: e.message || 'Грешка при изтриване' };
  }
}

async function handleVoiceMarkDone(args) {
  const taskId = await resolveTaskId(args);
  if (!taskId) return { error: 'Не намерих задача с това описание.' };

  try {
    await markDone(taskId);
    return { success: true, task_id: taskId, message: 'Задачата е маркирана като завършена.' };
  } catch (e) {
    return { error: e.message || 'Грешка' };
  }
}

async function handleVoiceDiscussTask(args) {
  const taskId = await resolveTaskId(args);
  const task = taskId ? getTaskById(taskId) : null;

  if (args.add_note && taskId && args.advice) {
    const currentTask = task || {};
    const newNotes = currentTask.notes ? `${currentTask.notes}\n\n📌 ${args.advice}` : `📌 ${args.advice}`;
    await fetch(`${API_BASE}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, notes: newNotes }),
    });
    await loadTasks();
    return { success: true, message: 'Съветът е добавен като бележка към задачата.' };
  }

  if (task) {
    return {
      success: true,
      task: { id: task.id, content: task.content, priority: task.priority, due_date: task.due_date, notes: task.notes, tags: task.tags },
      message: 'Ето контекста на задачата. Дай съвет на базата на тази информация.',
    };
  }

  return { success: true, message: 'Обсъждаме задачата. Използвай Google Search за актуална информация.' };
}

async function fetchExternalEvents() {
  if (!window.AIVA_CALENDAR_SYNC?.syncIncomingEvents) return;
  let start;
  let end;
  if (calendarView === 'week') {
    const s = startOfWeek(currentDate);
    start = toISODate(s);
    end = toISODate(addDays(s, 6));
  } else if (calendarView === 'month') {
    const s = startOfWeek(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    start = toISODate(s);
    end = toISODate(addDays(s, 41));
  } else if (calendarView === 'three') {
    start = toISODate(currentDate);
    end = toISODate(addDays(currentDate, 2));
  } else {
    start = toISODate(currentDate);
    end = start;
  }
  externalEvents = await window.AIVA_CALENDAR_SYNC.syncIncomingEvents(start, end);
}

async function refreshExternalEvents() {
  await fetchExternalEvents();
  renderCalendar();
}

async function loadTasks() {
  try {
    // Условно опресняване: с ETag от последния отговор сървърът връща празен
    // 304, когато нищо не е променено — кешът остава валиден без трансфер.
    const headers = {};
    const lastEtag = localStorage.getItem('aiva_tasks_etag');
    if (lastEtag && localStorage.getItem(TASKS_CACHE_KEY) !== null) {
      headers['If-None-Match'] = lastEtag;
    }

    const res = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(userId)}`, { headers });
    if (res.status === 304) return; // кешираните задачи са актуални
    if (!res.ok) return;
    const ct = res.headers.get('content-type');
    if (!ct?.includes('application/json')) return;

    const data = await res.json();
    tasks = data.tasks || [];
    try {
      localStorage.setItem(TASKS_CACHE_KEY, JSON.stringify(tasks));
      const etag = res.headers.get('etag');
      if (etag) localStorage.setItem('aiva_tasks_etag', etag);
      else localStorage.removeItem('aiva_tasks_etag');
    } catch (_e) { /* пълен storage — кешът е best-effort */ }
    renderCalendar();
    if (window.AIVA_CALENDAR_ONBOARD) {
      window.AIVA_CALENDAR_ONBOARD.checkAfterLoad(tasks);
    }
    // Re-schedule notifications when tasks are refreshed
    if (window.AIVA_NOTIFIER && assistantSettings.notifications?.enabled) {
      window.AIVA_NOTIFIER.scheduleAll(tasks, assistantSettings.notifications.reminderMinutes);
    }
  } catch (e) {
    console.error('loadTasks:', e);
  }
}

async function markDone(taskId) {
  try {
    await fetch(`${API_BASE}/api/tasks/${taskId}/done`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (window.AIVA_CALENDAR_SYNC?.onTaskDone) {
      await window.AIVA_CALENDAR_SYNC.onTaskDone(taskId);
    }
    await loadTasks();
  } catch (e) {
    console.error('markDone:', e);
  }
}

function showSubscriptionPaywall(data) {
  const code = data?.code;
  if (code && window.AIVA_SUBSCRIPTION?.showPaywall) {
    window.AIVA_SUBSCRIPTION.showPaywall(code);
  }
}

async function persistTask(args) {
  const defaults = assistantSettings.defaults;
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      task: args.task,
      emotion: args.emotion || defaults.emotion,
      priority: args.priority || defaults.priority,
      due_date: args.due_date,
      due_time: args.due_time,
      estimated_minutes: args.estimated_minutes || defaults.estimatedMinutes,
      notes: args.notes,
      location: args.location,
      repeat_rule: args.repeat_rule,
      tags: args.tags,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    showSubscriptionPaywall(data);
    throw new Error(data.error || t('errSave'));
  }
  showToast(data.task);
  await loadTasks();
  if (window.AIVA_CALENDAR_SYNC) {
    await window.AIVA_CALENDAR_SYNC.handleTaskSaved(data.task);
  }
  return { success: true, task_id: data.task.id, content: data.task.content };
}

async function saveTaskFromForm() {
  const formData = new FormData(taskForm);
  const id = formData.get('id');
  const payload = {
    user_id: userId,
    content: String(formData.get('content') || '').trim(),
    emotion: formData.get('emotion') || 'neutral',
    priority: Number(formData.get('priority')) || assistantSettings.defaults.priority,
    due_date: formData.get('due_date') || null,
    due_time: formData.get('due_time') || null,
    estimated_minutes: formData.get('estimated_minutes') ? Number(formData.get('estimated_minutes')) : null,
    notes: formData.get('notes') || null,
    location: formData.get('location') || null,
    repeat_rule: formData.get('repeat_rule') || null,
    tags: formData.get('tags') || null,
  };

  if (!payload.content) {
    showError(t('errTaskName'));
    return null;
  }

  const url = id ? `${API_BASE}/api/tasks/${id}` : `${API_BASE}/api/tasks`;
  const res = await fetch(url, {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(id ? payload : { ...payload, task: payload.content }),
  });
  const data = await res.json();
  if (!res.ok) {
    showSubscriptionPaywall(data);
    throw new Error(data.error || t('errSave'));
  }
  await loadTasks();
  showToast(data.task);
  if (window.AIVA_CALENDAR_SYNC) {
    await window.AIVA_CALENDAR_SYNC.handleTaskSaved(data.task, { skipPrompt: !!id });
  }
  return data.task;
}

async function removeTask(taskId) {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || t('errDelete'));
  if (window.AIVA_CALENDAR_SYNC?.onTaskRemoved) {
    await window.AIVA_CALENDAR_SYNC.onTaskRemoved(taskId);
  }
  await loadTasks();
}

function parseDuplicateRows(value) {
  return value
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [date, time] = row.split(/[,\s]+/).filter(Boolean);
      return { due_date: date || null, due_time: time || null };
    })
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.due_date || ''));
}

async function duplicateTaskToRows(taskId) {
  const rows = parseDuplicateRows(duplicateRowsField.value);
  if (!rows.length) {
    showError(t('errDupFormat'));
    return;
  }
  if (rows.length > assistantSettings.safety.maxDuplicateDays) {
    showError(tf('errDupMax', { max: assistantSettings.safety.maxDuplicateDays }));
    return;
  }

  for (const row of rows) {
    const res = await fetch(`${API_BASE}/api/tasks/${taskId}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        due_date: row.due_date,
        due_time: row.due_time,
        repeat_rule: taskForm.elements.repeat_rule.value || null,
        notes: taskForm.elements.notes.value || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('errDup'));
  }

  await loadTasks();
  duplicateRowsField.value = '';
  showToast({ content: tf('toastCopies', { count: rows.length }), emotion: 'neutral', priority: 3 });
}

// --- Task modal ---
function fillTaskForm(task) {
  const defaults = assistantSettings.defaults;
  taskIdField.value = task?.id || '';
  taskForm.elements.content.value = task?.content || '';
  taskForm.elements.emotion.value = task?.emotion || defaults.emotion;
  taskForm.elements.priority.value = task?.priority || defaults.priority;
  taskForm.elements.due_date.value = task?.due_date || toISODate(currentDate);
  taskForm.elements.due_time.value = task?.due_time || defaults.dueTime || '';
  taskForm.elements.estimated_minutes.value = task?.estimated_minutes || defaults.estimatedMinutes || '';
  taskForm.elements.location.value = task?.location || '';
  taskForm.elements.tags.value = task?.tags || '';
  taskForm.elements.repeat_rule.value = task?.repeat_rule || '';
  taskForm.elements.notes.value = task?.notes || '';
  duplicateRowsField.value = '';
}

function openTaskModal(task = null) {
  modalTitle.textContent = task ? t('taskDetails') : t('newTask');
  deleteTaskBtn.hidden = !task;
  duplicateTaskBtn.hidden = !task;
  discussTaskBtn.hidden = !task;
  fillTaskForm(task);
  taskModal.classList.add('visible');
  taskModal.setAttribute('aria-hidden', 'false');
  taskForm.elements.content.focus();
}

function closeTaskModal() {
  taskModal.classList.remove('visible');
  taskModal.setAttribute('aria-hidden', 'true');
}

function getTaskById(id) {
  return tasks.find((task) => String(task.id) === String(id));
}

// --- Gemini message handling (from official script.js pattern) ---
async function handleGeminiMessage(message) {
  touchSessionActivity();
  switch (message.type) {
    case MultimodalLiveResponseType.SETUP_COMPLETE:
      reconnectAttempts = 0;
      acquireWakeLock();
      setStatus(t('listening'), true);
      waveform.classList.add('active');
      if (resumingSession) {
        // Възстановена сесия след прекъсната връзка: без ново поздравление,
        // микрофонът продължава (стриймърът не е спиран при WS drop)
        resumingSession = false;
        isSessionActive = true;
        try {
          await ensureMicStreaming();
          // Прекъснатият ход на асистента е загубен — отпушваме uplink-а,
          // за да не остане микрофонът ням след възстановяване
          setMicUplinkMuted(false);
        } catch (e) {
          console.error('Mic resume failed:', e);
          showError(t('errMicrophone'));
          disconnectSession();
        }
        break;
      }
      awaitingGreetingMic = true;
      try {
        isSessionActive = true;
        recordBtn.classList.add('recording');
        recordBtn.setAttribute('aria-label', t('stopRecording'));
        window.AIVA_HAPTICS?.onListeningStart?.();
        sendSessionGreeting();
        scheduleGreetingMicFallback();
      } catch (e) {
        console.error('Session greeting failed:', e);
        showError(t('errConnect'));
        disconnectSession();
      }
      break;

    case MultimodalLiveResponseType.AUDIO:
      assistantTurnComplete = false;
      lastAssistantAudioAt = performance.now();
      if (audioPlayer) await audioPlayer.play(message.data);
      break;

    case MultimodalLiveResponseType.OUTPUT_TRANSCRIPTION:
      if (message.data?.text) {
        assistantTranscriptBuffer += message.data.text;
        setAssistantSpeech(assistantTranscriptBuffer);
        if (message.data.finished) {
          maybeScheduleSessionEndFromFarewell('output_transcription');
        }
      }
      break;

    case MultimodalLiveResponseType.INPUT_TRANSCRIPTION:
      if (message.data?.text) {
        userTranscriptBuffer += message.data.text;
        handleUserGoodbyeTranscript(userTranscriptBuffer, message.data.finished);
        if (message.data.finished) userTranscriptBuffer = '';
      }
      break;

    case MultimodalLiveResponseType.TEXT:
      if (message.data) {
        assistantTranscriptBuffer = String(message.data);
        setAssistantSpeech(assistantTranscriptBuffer);
      }
      break;

    case MultimodalLiveResponseType.TOOL_CALL: {
      const functionResponses = [];
      for (const call of message.data.functionCalls || []) {
        try {
          let result;
          switch (call.name) {
            case 'save_task':
              result = await persistTask(call.args || {});
              break;
            case 'read_tasks':
              result = await handleVoiceReadTasks(call.args || {});
              break;
            case 'edit_task':
              result = await handleVoiceEditTask(call.args || {});
              break;
            case 'delete_task':
              result = await handleVoiceDeleteTask(call.args || {});
              break;
            case 'mark_task_done':
              result = await handleVoiceMarkDone(call.args || {});
              break;
            case 'discuss_task':
              result = await handleVoiceDiscussTask(call.args || {});
              break;
            case 'read_calendar_events':
              result = await handleVoiceReadCalendarEvents(call.args || {});
              break;
            case 'edit_calendar_event':
              result = await handleVoiceEditCalendarEvent(call.args || {});
              break;
            case 'delete_calendar_event':
              result = await handleVoiceDeleteCalendarEvent(call.args || {});
              break;
            case 'end_session':
              scheduleSessionEnd();
              result = { success: true, message: 'Сесията приключва.' };
              break;
            default:
              if (String(call.name || '').startsWith('device_')) {
                result = await window.AIVA_DEVICE_ACTIONS?.handleTool?.(call.name, call.args || {})
                  ?? { ok: false, error: 'device actions unavailable' };
                break;
              }
              result = client.callFunction(call.name, call.args || {}) ?? 'ok';
              break;
          }
          functionResponses.push({ id: call.id, name: call.name, response: { result } });
        } catch (e) {
          functionResponses.push({ id: call.id, name: call.name, response: { error: e.message || 'Грешка' } });
        }
      }
      if (functionResponses.length) client.sendToolResponse(functionResponses);
      break;
    }

    case MultimodalLiveResponseType.TURN_COMPLETE:
      maybeScheduleSessionEndFromFarewell('turn_complete');
      assistantTranscriptBuffer = '';
      assistantTurnComplete = true;
      if (awaitingGreetingMic) {
        startMicAfterGreeting();
      } else if (sessionEnding) {
        farewellTurnCompleteReceived = true;
        clearSessionEndFallback();
        tryFinalizeSessionEnd();
      } else if (!sessionEnding) {
        tryUnmuteMicAfterAssistant();
      }
      break;

    case MultimodalLiveResponseType.INTERRUPTED:
      // Ignore spurious interrupts during greeting or while assistant speaks;
      // при приключване сбогуването трябва да дозвучи докрай
      if (awaitingGreetingMic || sessionEnding || audioStreamer?.uplinkMuted) break;
      if (audioPlayer) audioPlayer.interrupt();
      assistantTranscriptBuffer = '';
      assistantTurnComplete = false;
      setMicUplinkMuted(false);
      break;

    case MultimodalLiveResponseType.ERROR:
      showError(typeof message.data === 'string' ? message.data : t('errGemini'));
      break;

    default:
      break;
  }
}

function sendSessionGreeting() {
  if (!client) return;
  const userName = (assistantSettings.profile?.userName || '').trim();
  let prompt = t('listeningGreetingPrompt');
  if (userName) {
    prompt += ` ${tf('addressUserAs', { name: userName })}`;
  }

  // Проактивен бриф: при първата сесия за деня асистентът обобщава днешните задачи
  const todayIso = toISODate(new Date());
  if (localStorage.getItem('aiva_last_brief_date') !== todayIso) {
    const todaysTasks = tasks.filter((task) => task.due_date === todayIso);
    if (todaysTasks.length) {
      prompt += ` ${tf('morningBriefPrompt', { count: todaysTasks.length })}`;
    }
    localStorage.setItem('aiva_last_brief_date', todayIso);
  }

  client.sendTextMessage(prompt);
}

async function fetchToken() {
  const res = await fetch(`${API_BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  const data = await parseJsonResponse(res, 'Грешка при заявка за токен');
  if (!res.ok) {
    if (data.code === 'SESSION_LIMIT') {
      window.AIVA_SUBSCRIPTION?.showPaywall?.('SESSION_LIMIT');
    }
    throw new Error(data.error || tf('errInvalidResponse', { status: res.status }));
  }
  if (!data.token) throw new Error(t('errToken'));
  return data.token;
}

async function connectSession() {
  if (isConnecting || isSessionActive) return;
  isConnecting = true;
  recordBtn.disabled = true;
  setRecordBtnLive(true);
  setStatus(t('connecting'), true);
  applyPreferences({ i18n: false });

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(t('errMicUnsupported'));
    }

    await loadTasks();
    const calendarEvents = await loadCalendarEventsForAssistant();

    const token = await fetchToken();
    const subData = await window.AIVA_SUBSCRIPTION?.fetchSubscription?.() ?? null;
    const model = assistantSettings.model || LIVE_MODEL;

    client = new GeminiLiveAPI(token, model);
    assistantTranscriptBuffer = '';
    assistantTurnComplete = false;
    let extraContext = buildTasksContextForAssistant()
      + buildCalendarContextForAssistant(calendarEvents);
    if (voiceFocusTask) {
      extraContext += `\n\nФОКУС: Потребителят иска да обсъди или редактира задача ID ${voiceFocusTask.id}: "${voiceFocusTask.content}". Започни с кратко потвърждение и предложи помощ (редакция, съвет, изтриване, маркиране като готова).`;
      voiceFocusTask = null;
    }
    const instructions = buildSessionInstructions(
      assistantSettings.systemInstructions,
      assistantSettings.profile,
      extraContext
    );
    client.systemInstructions = instructions;
    // Транскрипцията е винаги включена: нужна за UI и надеждно затваряне при сбогуване.
    client.inputAudioTranscription = true;
    client.outputAudioTranscription = true;
    client.responseModalities = assistantSettings.responseModalities;
    client.voiceName = assistantSettings.voiceName;
    client.temperature = assistantSettings.temperature;
    client.googleGrounding =
      assistantSettings.googleGrounding
      && window.AIVA_SUBSCRIPTION?.canUseFeature?.(subData, 'google_grounding');
    client.automaticActivityDetection = assistantSettings.automaticActivityDetection;
    client.activityHandling = assistantSettings.activityHandling;
    client.addFunction(new SaveTaskTool());
    client.addFunction(new ReadTasksTool());
    client.addFunction(new EditTaskTool());
    client.addFunction(new DeleteTaskTool());
    client.addFunction(new MarkTaskDoneTool());
    client.addFunction(new DiscussTaskTool());
    client.addFunction(new ReadCalendarEventsTool());
    client.addFunction(new EditCalendarEventTool());
    client.addFunction(new DeleteCalendarEventTool());
    const endSessionTool = new EndSessionTool();
    const sessionLang = assistantSettings.profile?.language || 'bg';
    if (window.AIVA_SESSION_END?.getEndSessionToolDescription) {
      endSessionTool.description = window.AIVA_SESSION_END.getEndSessionToolDescription(sessionLang);
    }
    client.addFunction(endSessionTool);
    for (const tool of window.AIVA_DEVICE_ACTIONS?.getGeminiTools?.() || []) {
      client.addFunction(tool);
    }

    client.onReceiveResponse = handleGeminiMessage;
    client.onOpen = () => setStatus(t('connecting'), true);
    client.onClose = () => handleSocketClose();
    client.onError = (msg) => {
      // При активна сесия onClose поема опита за reconnect; грешка преди
      // установена сесия е фатална и се показва веднага.
      if (!isSessionActive) {
        showError(msg || t('errConnect'));
        disconnectSession();
      }
    };

    if (!audioPlayer) {
      audioPlayer = new AudioPlayer();
      audioPlayer.onPlaybackStateChange = onAssistantPlaybackStateChange;
      await audioPlayer.init();
    } else {
      audioPlayer.onPlaybackStateChange = onAssistantPlaybackStateChange;
    }

    client.connect();
  } catch (e) {
    console.error('connectSession:', e);
    showError(e.message || t('errConnect'));
    disconnectSession();
  } finally {
    isConnecting = false;
    recordBtn.disabled = false;
  }
}

function disconnectSession() {
  const wasActive = isSessionActive;
  clearSessionEndState();
  clearGreetingMicTimer();
  clearSessionIdleTimer();
  releaseWakeLock();
  reconnectAttempts = 0;
  resumingSession = false;
  awaitingGreetingMic = false;
  if (audioStreamer) {
    audioStreamer.stop();
    audioStreamer = null;
  }
  if (client?.webSocket) {
    client.webSocket.close();
  }
  client = null;
  isSessionActive = false;
  isConnecting = false;
  assistantTranscriptBuffer = '';
  assistantTurnComplete = false;
  recordBtn.classList.remove('recording');
  setRecordBtnLive(false);
  recordBtn.disabled = false;
  waveform.classList.remove('active');
  statusEl.classList.remove('assistant-speech');
  setStatus(t('tapToRecord'));
  recordBtn.setAttribute('aria-label', t('record'));
  if (wasActive) {
    window.AIVA_HAPTICS?.onListeningStop?.();
  }
}

// --- Events ---
recordBtn.addEventListener('click', () => {
  if (isSessionActive || isConnecting) {
    disconnectSession();
  } else {
    connectSession();
  }
});

viewButtons.forEach((button) => {
  button.addEventListener('click', () => {
    calendarView = button.dataset.view;
    if (calendarView === 'week') {
      weekFocusDate = new Date(currentDate);
    }
    renderCalendar();
    refreshExternalEvents();
  });
});

prevRangeBtn.addEventListener('click', () => moveCalendar(-1));
nextRangeBtn.addEventListener('click', () => moveCalendar(1));
todayBtn.addEventListener('click', () => {
  currentDate = new Date();
  weekFocusDate = new Date();
  renderCalendar();
  refreshExternalEvents();
});
addTaskBtn.addEventListener('click', () => openTaskModal());

tasksContainer.addEventListener('click', (e) => {
  const check = e.target.closest('.task-check');
  if (check) {
    e.stopPropagation();
    const item = check.closest('.task-item');
    if (item) {
      item.style.opacity = '0';
      item.style.transform = 'translateX(20px)';
      item.style.transition = 'all 0.3s ease';
    }
    setTimeout(() => markDone(check.dataset.id), 300);
    return;
  }

  const weekDayBtn = e.target.closest('.week-day-btn');
  if (weekDayBtn) {
    weekFocusDate = parseISODate(weekDayBtn.dataset.date) || weekFocusDate;
    renderCalendar();
    return;
  }

  const monthCell = e.target.closest('.month-cell');
  if (monthCell) {
    currentDate = parseISODate(monthCell.dataset.date) || currentDate;
    renderCalendar();
    return;
  }

  const card = e.target.closest('.task-card');
  if (card && !card.dataset.external) {
    openTaskModal(getTaskById(card.dataset.id));
  }
});

tasksContainer.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.task-card');
  if (!card || card.dataset.external) return;
  e.preventDefault();
  openTaskModal(getTaskById(card.dataset.id));
});

tasksContainer.addEventListener('touchstart', (e) => {
  touchStartX = e.changedTouches[0].clientX;
}, { passive: true });

tasksContainer.addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const delta = e.changedTouches[0].clientX - touchStartX;
  touchStartX = null;
  if (Math.abs(delta) < 60) return;
  moveCalendar(delta < 0 ? 1 : -1);
}, { passive: true });

taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await saveTaskFromForm();
    closeTaskModal();
  } catch (error) {
    showError(error.message || t('errSave'));
  }
});

deleteTaskBtn.addEventListener('click', async () => {
  const id = taskIdField.value;
  if (!id) return;
  if (assistantSettings.safety.askBeforeDelete && !confirm(t('confirmDelete'))) return;
  try {
    await removeTask(id);
    closeTaskModal();
  } catch (error) {
    showError(error.message || t('errDelete'));
  }
});

duplicateTaskBtn.addEventListener('click', async () => {
  const id = taskIdField.value;
  if (!id) return;
  try {
    await duplicateTaskToRows(id);
  } catch (error) {
    showError(error.message || t('errDup'));
  }
});

discussTaskBtn.addEventListener('click', () => {
  const task = getTaskById(taskIdField.value);
  if (!task) return;
  voiceFocusTask = task;
  closeTaskModal();
  if (!isSessionActive && !isConnecting) {
    connectSession();
  }
});

addToCalendarBtn.addEventListener('click', async () => {
  const task = {
    id: taskIdField.value || `new-${Date.now()}`,
    content: taskForm.elements.content.value,
    due_date: taskForm.elements.due_date.value || null,
    due_time: taskForm.elements.due_time.value || null,
    estimated_minutes: taskForm.elements.estimated_minutes.value || null,
    location: taskForm.elements.location.value || null,
    tags: taskForm.elements.tags.value || null,
    notes: taskForm.elements.notes.value || null,
  };
  if (!task.content) {
    showError(t('errTaskCalendar'));
    return;
  }
  try {
    let result;
    if (window.AIVA_CALENDAR_CRUD?.isAndroid?.()) {
      result = await window.AIVA_CALENDAR_CRUD.createAivaEvent(task);
    } else {
      const native = window.AIVA_NATIVE_CALENDAR;
      result = native
        ? await native.addToDeviceCalendar(task)
        : await window.AIVA_CALENDAR.addToDevice(task);
    }
    if (result?.method !== 'aborted' && result !== 'aborted') {
      showToast({ content: t('toastCalendarAdd'), emotion: 'neutral', priority: 3 });
    }
  } catch (error) {
    showError(error.message || t('errCalendar'));
  }
});

closeTaskModalBtn.addEventListener('click', closeTaskModal);
taskModal.addEventListener('click', (e) => {
  if (e.target === taskModal) closeTaskModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && taskModal.classList.contains('visible')) closeTaskModal();
});

window.addEventListener('aiva:settings-updated', () => {
  applyPreferences();
  syncProfileToServer();
  renderCalendar();
  window.AIVA_CALENDAR_ONBOARD?.updateHeaderStatus?.();
  window.AIVA_CALENDAR_ONBOARD?.updateBanner?.(tasks.some((t) => t.due_date));
});

window.addEventListener('aiva:profile-updated', () => {
  applyPreferences();
});

window.addEventListener('aiva:calendar-connected', () => {
  showToast({ content: t('toastCalendarSync'), emotion: 'neutral', priority: 3 });
});

window.addEventListener('aiva:task-done-from-notif', () => {
  loadTasks();
});

window.addEventListener('aiva:notification-fired', () => {
  renderUpcomingStrip();
});

if (upcomingList) {
  upcomingList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      const taskId = btn.dataset.id;
      const action = btn.dataset.action;
      const task = getTaskById(taskId);
      if (action === 'done') {
        await markDone(taskId);
      } else if (action === 'snooze' && task && window.AIVA_NOTIFIER) {
        await window.AIVA_NOTIFIER.snoozeTask(taskId, task.content, 10);
        showToast({ content: t('toastSnooze10'), emotion: 'neutral', priority: 3 });
      }
      return;
    }
    const item = e.target.closest('.upcoming-item');
    if (item) openTaskModal(getTaskById(item.dataset.id));
  });
}

// Refresh countdowns every minute — update text in place instead of
// rebuilding the whole calendar DOM.
function updateCountdownsInPlace() {
  document.querySelectorAll('.task-card').forEach((card) => {
    const task = getTaskById(card.dataset.id);
    if (!task) return;
    const countdownEl = card.querySelector('.task-countdown');
    if (countdownEl) countdownEl.textContent = getTaskCountdown(task);
    card.classList.toggle('is-overdue', isTaskOverdue(task));
  });
}

setInterval(() => {
  if (tasks.length) {
    renderUpcomingStrip();
    updateCountdownsInPlace();
  }
}, 60000);

// --- Daily brief card (generated by the evening cron) ---
const briefCard = document.getElementById('briefCard');
const briefText = document.getElementById('briefText');
const briefDismissBtn = document.getElementById('briefDismiss');

async function loadDailyBrief() {
  if (!briefCard || !briefText) return;
  try {
    const res = await fetch(`${API_BASE}/api/brief/${encodeURIComponent(userId)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.locked) return;
    const brief = data.brief;
    if (!brief?.text) return;
    if (localStorage.getItem('aiva_brief_dismissed') === brief.generated_at) return;
    briefText.textContent = brief.text;
    briefCard.dataset.generatedAt = brief.generated_at || '';
    briefCard.hidden = false;
  } catch (_e) { /* офлайн — картата просто не се показва */ }
}

briefDismissBtn?.addEventListener('click', () => {
  briefCard.hidden = true;
  localStorage.setItem('aiva_brief_dismissed', briefCard.dataset.generatedAt || 'unknown');
});

// --- Device-specific first-run setup (Android APK) ---
// Засича марката при първото стартиране ("инсталация") и ако телефонът има
// агресивен battery manager (Xiaomi, Huawei, Oppo...), показва еднократен
// банер към настройките за автостарт/батерия.
async function initDeviceBanner() {
  const banner = document.getElementById('deviceBanner');
  if (!banner || !window.AIVA_DEVICE?.isAndroid?.()) return;
  if (localStorage.getItem('aiva_device_banner_done')) return;

  const profile = await window.AIVA_DEVICE.detect();
  if (!profile) return;

  const needsAttention = profile.needsAutostart || !profile.batteryOptimizationIgnored;
  if (!needsAttention) {
    localStorage.setItem('aiva_device_banner_done', '1');
    return;
  }

  banner.hidden = false;
  document.getElementById('deviceBannerOpen')?.addEventListener('click', () => {
    localStorage.setItem('aiva_device_banner_done', '1');
    location.href = `${window.AIVA_CONFIG.appUrl('settings.html')}#deviceSetupSection`;
  });
  document.getElementById('deviceBannerDismiss')?.addEventListener('click', () => {
    localStorage.setItem('aiva_device_banner_done', '1');
    banner.hidden = true;
  });
}

applyPreferences();
syncProfileToServer();
renderCalendar();
loadTasks();
refreshExternalEvents();
loadDailyBrief();
initDeviceBanner();
initPaywallUi();

function initPaywallUi() {
  document.getElementById('paywallDismissBtn')?.addEventListener('click', () => {
    window.AIVA_SUBSCRIPTION?.hidePaywall?.();
  });
  document.getElementById('paywallMonthlyBtn')?.addEventListener('click', async () => {
    try {
      await window.AIVA_SUBSCRIPTION?.openCheckout?.('plus_monthly');
    } catch (e) {
      showErrorToast(e.message);
    }
  });
  document.getElementById('paywallYearlyBtn')?.addEventListener('click', async () => {
    try {
      await window.AIVA_SUBSCRIPTION?.openCheckout?.('plus_yearly');
    } catch (e) {
      showErrorToast(e.message);
    }
  });
}

function initHardwareShortcut() {
  if (!window.AIVA_SHORTCUT?.isAndroid?.()) return;
  const cfg = assistantSettings.hardwareShortcut || { enabled: true };
  window.AIVA_SHORTCUT.applyShortcutConfig(cfg);
  window.AIVA_SHORTCUT.onShortcutTriggered(tryAutoStartListening);
  window.AIVA_SHORTCUT.consumePendingLaunch().then((pending) => {
    if (pending) waitForReadyAndListen();
  });
}

function tryAutoStartListening() {
  if (isSessionActive || isConnecting) return;
  connectSession();
}

function waitForReadyAndListen(attempts = 30) {
  if (window.AIVA_CONFIG && document.readyState === 'complete') {
    setTimeout(tryAutoStartListening, 700);
    return;
  }
  if (attempts <= 0) return;
  setTimeout(() => waitForReadyAndListen(attempts - 1), 200);
}

window.addEventListener('aiva:shortcut-triggered', tryAutoStartListening);
initHardwareShortcut();

// Initialize notification scheduler + auto permissions on APK
if (window.AIVA_NOTIFIER) {
  window.AIVA_NOTIFIER.init().then(async () => {
    if (window.Capacitor?.isNativePlatform?.()) {
      await window.AIVA_NATIVE_PERMISSIONS?.bootstrap?.();
      return;
    }
    if (!assistantSettings.notifications?.enabled) return;
    window.AIVA_NOTIFIER.scheduleAll(tasks, assistantSettings.notifications.reminderMinutes);
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data?.type === 'aiva:snooze' && window.AIVA_NOTIFIER) {
      const task = getTaskById(event.data.taskId);
      if (task) {
        await window.AIVA_NOTIFIER.snoozeTask(event.data.taskId, task.content, event.data.minutes || 10);
        showToast({ content: t('toastSnooze'), emotion: 'neutral', priority: 3 });
      }
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (audioPlayer?.audioContext?.state === 'suspended') {
    audioPlayer.audioContext.resume().catch(() => {});
  }
  if (audioStreamer?.audioContext?.state === 'suspended') {
    audioStreamer.audioContext.resume().catch(() => {});
  }
});
