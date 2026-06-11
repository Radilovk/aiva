/**
 * AIVA — voice task assistant with calendar task management (Bulgarian)
 */

const { API_BASE, LIVE_MODEL } = window.AIVA_CONFIG;
const { loadAssistantSettings } = window.AIVA_SETTINGS;

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
let tasks = [];
let externalEvents = [];
let currentDate = new Date();
let calendarView = assistantSettings.calendar.defaultView || 'day';
let touchStartX = null;
let voiceFocusTask = null;
let cachedCalendarEvents = [];
let awaitingCloseConfirmation = false;
let pendingUserTranscript = '';
let assistantTranscriptBuffer = '';

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
      'Приключва гласовата сесия когато потребителят няма нужда от още помощ.',
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
  return new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short' }).format(date);
}

function formatDateLong(date) {
  return new Intl.DateTimeFormat('bg-BG', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function formatMonth(date) {
  return new Intl.DateTimeFormat('bg-BG', { month: 'long', year: 'numeric' }).format(date);
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

// --- UI helpers ---
function applyPreferences() {
  assistantSettings = loadAssistantSettings();
  document.documentElement.style.setProperty('--accent', assistantSettings.appearance.accentColor);
  document.body.classList.toggle('compact-calendar', assistantSettings.appearance.compactCalendar);
}

function setStatus(text, active = false, mode = 'default') {
  statusEl.textContent = text;
  statusEl.classList.toggle('active', active);
  statusEl.classList.toggle('assistant-speech', mode === 'assistant');
}

function setAssistantSpeech(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  setStatus(trimmed, true, 'assistant');
}

const CLOSING_QUESTION_RE = /още\s+нещо|нужда\s+от\s+още|нещо\s+друго|мога\s+ли\s+още/i;
const NEGATIVE_CLOSE_RE = /^(не|не,?\s*(благодаря|мерси)?|няма|нищо|готово|достатъчно|не\s+искам|не\s+е\s+нужно)\b/i;

function detectClosingQuestion(text) {
  if (CLOSING_QUESTION_RE.test(String(text || '').toLowerCase())) {
    awaitingCloseConfirmation = true;
  }
}

function isNegativeCloseResponse(text) {
  const normalized = String(text || '').toLowerCase().trim().replace(/[.!?,…]+$/g, '');
  if (!normalized) return false;
  return NEGATIVE_CLOSE_RE.test(normalized);
}

function scheduleSessionEnd(delayMs = 700) {
  awaitingCloseConfirmation = false;
  pendingUserTranscript = '';
  setTimeout(() => {
    if (isSessionActive) disconnectSession();
  }, delayMs);
}

function handlePossibleCloseResponse(text, finished = false) {
  if (!awaitingCloseConfirmation || !text) return;
  const combined = `${pendingUserTranscript}${text}`.trim();
  pendingUserTranscript = finished ? '' : combined;
  if (isNegativeCloseResponse(combined)) {
    scheduleSessionEnd();
  }
}

function showError(msg) {
  errorToast.textContent = msg;
  errorToast.classList.add('visible');
  setTimeout(() => errorToast.classList.remove('visible'), 5000);
}

window.showCalendarSyncToast = function showCalendarSyncToast(task) {
  showToast({
    content: task?.content ? `${task.content} → календар` : 'Добавена в календара',
    emotion: 'neutral',
    priority: 3,
  });
};

function showToast(task) {
  toastContent.textContent = task.content;
  const emotionMap = { stress: '😰', tired: '😴', urgent: '⚡', neutral: '😊' };
  toastMeta.innerHTML = `
    <span>${emotionMap[task.emotion] || '😊'} ${escapeHtml(task.emotion || 'neutral')}</span>
    <span>⚡ ${escapeHtml(`П${task.priority}`)}</span>
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
          <button class="upcoming-action-btn" data-action="snooze" data-id="${task.id}" type="button" title="Отложи 10 мин">⏰</button>
          <button class="upcoming-action-btn" data-action="done" data-id="${task.id}" type="button" title="Готово">✓</button>
        </div>
      </div>
    `;
  }).join('');
}

function taskMeta(task) {
  const meta = [];
  if (task.due_time) meta.push(task.due_time);
  if (task.estimated_minutes) meta.push(`${task.estimated_minutes} мин`);
  if (task.location) meta.push(task.location);
  if (task.tags) meta.push(task.tags);
  return meta;
}

function renderTaskCard(task, mode = 'agenda') {
  const meta = taskMeta(task);
  const overdue = isTaskOverdue(task);
  const countdown = getTaskCountdown(task);
  const synced = window.AIVA_NATIVE_CALENDAR?.isTaskSynced?.(task.id);
  const statusClass = overdue ? 'is-overdue' : (countdown.startsWith('след') && countdown.includes('мин') && parseInt(countdown.match(/\d+/)?.[0] || '999', 10) <= 60 ? 'is-upcoming' : '');

  return `
    <article class="task-item task-card task-${escapeHtml(task.emotion || 'neutral')} ${statusClass}${task.isExternal ? ' external-event' : ''}" data-id="${task.id}"${task.isExternal ? ' data-external="true"' : ''} tabindex="0">
      <button class="task-check" data-id="${task.id}" aria-label="Маркирай като готова" type="button">
        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <div class="task-body">
        <div class="task-row">
          <div class="task-text">${escapeHtml(task.content)}</div>
          <span class="priority-pill">П${escapeHtml(task.priority || 3)}</span>
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
  });
}

function updateRangeLabel(dates) {
  if (calendarView === 'day') {
    rangeLabel.textContent = sameDay(currentDate, new Date()) ? `Днес · ${formatDateLong(currentDate)}` : formatDateLong(currentDate);
  } else if (calendarView === 'three') {
    rangeLabel.textContent = `${formatDateShort(dates[0])} - ${formatDateShort(dates[2])}`;
  } else if (calendarView === 'week') {
    rangeLabel.textContent = `Седмица · ${formatDateShort(dates[0])} - ${formatDateShort(dates[6])}`;
  } else {
    rangeLabel.textContent = formatMonth(currentDate);
  }
}

function renderAgendaView(dates) {
  updateRangeLabel(dates);
  const dayHtml = dates
    .map((date) => {
      const dayTasks = tasksForDate(date);
      return `
        <section class="calendar-day ${sameDay(date, new Date()) ? 'is-today' : ''}">
          <div class="day-header">
            <div>
              <span class="day-name">${escapeHtml(new Intl.DateTimeFormat('bg-BG', { weekday: 'short' }).format(date))}</span>
              <strong>${escapeHtml(formatDateShort(date))}</strong>
            </div>
            <span class="day-count">${dayTasks.length}</span>
          </div>
          <div class="day-stack">
            ${dayTasks.length ? dayTasks.map((task) => renderTaskCard(task)).join('') : '<div class="empty-state small">Няма задачи за този ден</div>'}
          </div>
        </section>
      `;
    })
    .join('');

  const unscheduled = assistantSettings.calendar.showUnscheduled ? unscheduledTasks() : [];
  tasksContainer.innerHTML = `
    <div class="agenda-grid view-${calendarView}">
      ${dayHtml}
    </div>
    ${
      unscheduled.length
        ? `<section class="unscheduled-block">
            <div class="day-header"><strong>Без дата</strong><span class="day-count">${unscheduled.length}</span></div>
            <div class="day-stack">${unscheduled.map((task) => renderTaskCard(task)).join('')}</div>
          </section>`
        : ''
    }
  `;
}

function renderMonthView() {
  const firstOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  updateRangeLabel(days);

  tasksContainer.innerHTML = `
    <div class="month-grid">
      ${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((day) => `<div class="month-weekday">${day}</div>`).join('')}
      ${days
        .map((date) => {
          const dayTasks = tasksForDate(date);
          const inMonth = date.getMonth() === currentDate.getMonth();
          return `
            <button class="month-cell ${inMonth ? '' : 'muted'} ${sameDay(date, new Date()) ? 'is-today' : ''}" data-date="${toISODate(date)}" type="button">
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
        <strong>${escapeHtml(formatDateLong(currentDate))}</strong>
        <span class="day-count">${tasksForDate(currentDate).length}</span>
      </div>
      <div class="day-stack">
        ${
          tasksForDate(currentDate).length
            ? tasksForDate(currentDate).map((task) => renderTaskCard(task, 'month')).join('')
            : '<div class="empty-state small">Избери ден със задачи или добави нова.</div>'
        }
      </div>
    </section>
  `;
}

function renderCalendar() {
  setActiveViewButton();
  tasksCount.textContent = tasks.length;
  renderUpcomingStrip();

  if (calendarView === 'day') {
    renderAgendaView([currentDate]);
  } else if (calendarView === 'three') {
    renderAgendaView([currentDate, addDays(currentDate, 1), addDays(currentDate, 2)]);
  } else if (calendarView === 'week') {
    const start = startOfWeek(currentDate);
    renderAgendaView(Array.from({ length: 7 }, (_, index) => addDays(start, index)));
  } else {
    renderMonthView();
  }
}

function moveCalendar(direction) {
  if (calendarView === 'day') {
    currentDate = addDays(currentDate, direction);
  } else if (calendarView === 'three') {
    currentDate = addDays(currentDate, direction * 3);
  } else if (calendarView === 'week') {
    currentDate = addDays(currentDate, direction * 7);
  } else {
    currentDate = addMonths(currentDate, direction);
  }
  renderCalendar();
  refreshExternalEvents();
}

// --- Tasks API ---
async function parseJsonResponse(res, fallbackMessage) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const preview = (await res.text()).trim().slice(0, 80);
    throw new Error(
      preview.startsWith('<!')
        ? 'API връща HTML вместо JSON. Проверете API адреса (config.js).'
        : fallbackMessage || `Невалиден отговор от сървъра (${res.status})`
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

  const lines = tasks.slice(0, 60).map((task) => {
    const parts = [`ID ${task.id}: "${task.content}"`];
    if (task.due_date) parts.push(`дата ${task.due_date}`);
    if (task.due_time) parts.push(`час ${task.due_time}`);
    if (task.priority) parts.push(`приоритет ${task.priority}`);
    if (task.notes) parts.push(`бележки: ${String(task.notes).slice(0, 120)}`);
    return `- ${parts.join(', ')}`;
  });

  return `\n\nТЕКУЩИ ЗАДАЧИ НА ПОТРЕБИТЕЛЯ (${tasks.length}):\n${lines.join('\n')}\n\nПри редакция, изтриване или обсъждане използвай task_id от списъка. Ако потребителят спомене задача по име, намери най-близкото съвпадение.`;
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

async function handleVoiceDeleteTask(args) {
  const taskId = await resolveTaskId(args);
  if (!taskId) return { error: 'Не намерих задача с това описание.' };

  try {
    await removeTask(taskId);
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

async function refreshExternalEvents() {
  if (!window.AIVA_CALENDAR_SYNC?.syncIncomingEvents) return;
  let start, end;
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
  renderCalendar();
}

async function loadTasks() {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(userId)}`);
    if (!res.ok) return;
    const ct = res.headers.get('content-type');
    if (!ct?.includes('application/json')) return;

    const data = await res.json();
    tasks = data.tasks || [];
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
    await fetch(`${API_BASE}/api/tasks/${taskId}/done`, { method: 'PATCH' });
    if (window.AIVA_CALENDAR_SYNC?.onTaskDone) {
      await window.AIVA_CALENDAR_SYNC.onTaskDone(taskId);
    }
    await loadTasks();
  } catch (e) {
    console.error('markDone:', e);
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
  if (!res.ok) throw new Error(data.error || 'Грешка при запис');
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
    showError('Добавете име/описание на задачата');
    return null;
  }

  const url = id ? `${API_BASE}/api/tasks/${id}` : `${API_BASE}/api/tasks`;
  const res = await fetch(url, {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(id ? payload : { ...payload, task: payload.content }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Грешка при запис');
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
  if (!res.ok) throw new Error(data.error || 'Грешка при изтриване');
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
    showError('Добавете поне една дата във формат YYYY-MM-DD HH:MM');
    return;
  }
  if (rows.length > assistantSettings.safety.maxDuplicateDays) {
    showError(`Максимумът за мултиплициране е ${assistantSettings.safety.maxDuplicateDays} дати.`);
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
    if (!res.ok) throw new Error(data.error || 'Грешка при мултиплициране');
  }

  await loadTasks();
  duplicateRowsField.value = '';
  showToast({ content: `Създадени копия: ${rows.length}`, emotion: 'neutral', priority: 3 });
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
  modalTitle.textContent = task ? 'Детайли за задачата' : 'Нова задача';
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
  switch (message.type) {
    case MultimodalLiveResponseType.SETUP_COMPLETE:
      setStatus('Слушам...', true);
      waveform.classList.add('active');
      try {
        if (!audioStreamer) audioStreamer = new AudioStreamer(client);
        await audioStreamer.start();
        isSessionActive = true;
        recordBtn.classList.add('recording');
        recordBtn.setAttribute('aria-label', 'Спри записа');
        window.AIVA_HAPTICS?.onListeningStart?.();
      } catch (e) {
        console.error('Audio start failed:', e);
        showError('Няма достъп до микрофона');
        disconnectSession();
      }
      break;

    case MultimodalLiveResponseType.AUDIO:
      if (audioPlayer) await audioPlayer.play(message.data);
      break;

    case MultimodalLiveResponseType.INPUT_TRANSCRIPTION:
      if (message.data?.text) {
        handlePossibleCloseResponse(message.data.text, message.data.finished === true);
      }
      break;

    case MultimodalLiveResponseType.OUTPUT_TRANSCRIPTION:
      if (message.data?.text) {
        assistantTranscriptBuffer += message.data.text;
        setAssistantSpeech(assistantTranscriptBuffer);
        detectClosingQuestion(assistantTranscriptBuffer);
        if (message.data.finished) {
          detectClosingQuestion(assistantTranscriptBuffer);
        }
      }
      break;

    case MultimodalLiveResponseType.TEXT:
      if (message.data) {
        assistantTranscriptBuffer = String(message.data);
        setAssistantSpeech(assistantTranscriptBuffer);
        detectClosingQuestion(assistantTranscriptBuffer);
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
              scheduleSessionEnd(500);
              result = { success: true, message: 'Сесията приключва.' };
              break;
            default:
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
      assistantTranscriptBuffer = '';
      pendingUserTranscript = '';
      break;

    case MultimodalLiveResponseType.INTERRUPTED:
      if (audioPlayer) audioPlayer.interrupt();
      assistantTranscriptBuffer = '';
      break;

    case MultimodalLiveResponseType.ERROR:
      showError(typeof message.data === 'string' ? message.data : 'Грешка от Gemini');
      break;

    default:
      break;
  }
}

async function fetchToken() {
  const res = await fetch(`${API_BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  const data = await parseJsonResponse(res, 'Грешка при заявка за токен');
  if (!res.ok) throw new Error(data.error || `Грешка ${res.status}`);
  if (!data.token) throw new Error('Невалиден токен');
  return data.token;
}

async function connectSession() {
  if (isConnecting || isSessionActive) return;
  isConnecting = true;
  recordBtn.disabled = true;
  setStatus('Свързване...', true);
  applyPreferences();

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Микрофонът не се поддържа в този браузър');
    }

    await loadTasks();
    const calendarEvents = await loadCalendarEventsForAssistant();

    const token = await fetchToken();
    const model = assistantSettings.model || LIVE_MODEL;

    client = new GeminiLiveAPI(token, model);
    awaitingCloseConfirmation = false;
    pendingUserTranscript = '';
    assistantTranscriptBuffer = '';
    let instructions = assistantSettings.systemInstructions
      + buildTasksContextForAssistant()
      + buildCalendarContextForAssistant(calendarEvents);
    if (voiceFocusTask) {
      instructions += `\n\nФОКУС: Потребителят иска да обсъди или редактира задача ID ${voiceFocusTask.id}: "${voiceFocusTask.content}". Започни с кратко потвърждение и предложи помощ (редакция, съвет, изтриване, маркиране като готова).`;
      voiceFocusTask = null;
    }
    client.systemInstructions = instructions;
    client.inputAudioTranscription = assistantSettings.inputAudioTranscription;
    client.outputAudioTranscription = assistantSettings.outputAudioTranscription;
    client.responseModalities = assistantSettings.responseModalities;
    client.voiceName = assistantSettings.voiceName;
    client.temperature = assistantSettings.temperature;
    client.googleGrounding = assistantSettings.googleGrounding;
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
    client.addFunction(new EndSessionTool());

    client.onReceiveResponse = handleGeminiMessage;
    client.onOpen = () => setStatus('Свързване...', true);
    client.onClose = () => {
      if (isSessionActive) disconnectSession();
    };
    client.onError = (msg) => {
      showError(msg || 'Грешка при свързване с Gemini');
      disconnectSession();
    };

    if (!audioPlayer) {
      audioPlayer = new AudioPlayer();
      await audioPlayer.init();
    }

    client.connect();
  } catch (e) {
    console.error('connectSession:', e);
    showError(e.message || 'Грешка при свързване');
    disconnectSession();
  } finally {
    isConnecting = false;
    recordBtn.disabled = false;
  }
}

function disconnectSession() {
  const wasActive = isSessionActive;
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
  awaitingCloseConfirmation = false;
  pendingUserTranscript = '';
  assistantTranscriptBuffer = '';
  recordBtn.classList.remove('recording');
  recordBtn.disabled = false;
  recordBtn.setAttribute('aria-label', 'Запис');
  waveform.classList.remove('active');
  statusEl.classList.remove('assistant-speech');
  setStatus('Докоснете за запис');
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
    renderCalendar();
    refreshExternalEvents();
  });
});

prevRangeBtn.addEventListener('click', () => moveCalendar(-1));
nextRangeBtn.addEventListener('click', () => moveCalendar(1));
todayBtn.addEventListener('click', () => {
  currentDate = new Date();
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
    showError(error.message || 'Грешка при запис');
  }
});

deleteTaskBtn.addEventListener('click', async () => {
  const id = taskIdField.value;
  if (!id) return;
  if (assistantSettings.safety.askBeforeDelete && !confirm('Да изтрия ли тази задача?')) return;
  try {
    await removeTask(id);
    closeTaskModal();
  } catch (error) {
    showError(error.message || 'Грешка при изтриване');
  }
});

duplicateTaskBtn.addEventListener('click', async () => {
  const id = taskIdField.value;
  if (!id) return;
  try {
    await duplicateTaskToRows(id);
  } catch (error) {
    showError(error.message || 'Грешка при мултиплициране');
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
    showError('Въведи задача преди да я добавиш в календара');
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
      showToast({ content: 'Добавено в календара на устройството', emotion: 'neutral', priority: 3 });
    }
  } catch (error) {
    showError(error.message || 'Грешка при добавяне в календара');
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
  renderCalendar();
  window.AIVA_CALENDAR_ONBOARD?.updateHeaderStatus?.();
  window.AIVA_CALENDAR_ONBOARD?.updateBanner?.(tasks.some((t) => t.due_date));
});

window.addEventListener('aiva:calendar-connected', () => {
  showToast({ content: 'Календарът е свързан', emotion: 'neutral', priority: 3 });
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
        showToast({ content: 'Напомнянето е отложено с 10 мин', emotion: 'neutral', priority: 3 });
      }
      return;
    }
    const item = e.target.closest('.upcoming-item');
    if (item) openTaskModal(getTaskById(item.dataset.id));
  });
}

// Refresh countdowns every minute
setInterval(() => {
  if (tasks.length) {
    renderUpcomingStrip();
    renderCalendar();
  }
}, 60000);

applyPreferences();
renderCalendar();
loadTasks();
refreshExternalEvents();

// Initialize notification scheduler
if (window.AIVA_NOTIFIER) {
  window.AIVA_NOTIFIER.init().then(() => {
    if (assistantSettings.notifications?.enabled) {
      window.AIVA_NOTIFIER.scheduleAll(tasks, assistantSettings.notifications.reminderMinutes);
    }
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (event.data?.type === 'aiva:snooze' && window.AIVA_NOTIFIER) {
      const task = getTaskById(event.data.taskId);
      if (task) {
        await window.AIVA_NOTIFIER.snoozeTask(event.data.taskId, task.content, event.data.minutes || 10);
        showToast({ content: 'Напомнянето е отложено', emotion: 'neutral', priority: 3 });
      }
    }
  });
}
