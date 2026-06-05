/**
 * AIVA — voice task assistant (Bulgarian)
 * Built on google-gemini/gemini-live-api-examples (ephemeral token + direct WebSocket).
 */

const { API_BASE, LIVE_MODEL } = window.AIVA_CONFIG;

const SYSTEM_INSTRUCTIONS = `Ти си личен асистент за задачи на български език.

ПРАВИЛА:
- Слушаш ТОНА на гласа, не само думите
- Ако потребителят звучи стресирано → отговаряш спокойно и уверено
- Ако звучи уморено → отговаряш много кратко
- Ако звучи бързащо → веднага минаваш към същественото
- Задаваш САМО ЕДИН въпрос
- НИКОГА не задаваш повече от един въпрос
- Говориш само на български
- Когато разбереш задачата, ИЗВИКАЙ функцията save_task с правилните параметри`;

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

// --- State ---
let client = null;
let audioStreamer = null;
let audioPlayer = null;
let isSessionActive = false;
let isConnecting = false;

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
          due_date: { type: 'string', description: 'Краен срок YYYY-MM-DD или празно' },
          estimated_minutes: { type: 'integer', description: 'Прогнозни минути' },
        },
      },
      ['task', 'emotion', 'priority']
    );
  }

  functionToCall() {
    return 'pending';
  }
}

// --- UI helpers ---
function setStatus(text, active = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('active', active);
}

function showError(msg) {
  errorToast.textContent = msg;
  errorToast.classList.add('visible');
  setTimeout(() => errorToast.classList.remove('visible'), 5000);
}

function showToast(task) {
  toastContent.textContent = task.content;
  const emotionMap = { stress: '😰', tired: '😴', urgent: '⚡', neutral: '😊' };
  toastMeta.innerHTML = `
    <span>${emotionMap[task.emotion] || '😊'} ${escapeHtml(task.emotion || 'neutral')}</span>
    <span>⚡ ${escapeHtml(`П${task.priority}`)}</span>
    ${task.due_date ? `<span>📅 ${escapeHtml(task.due_date)}</span>` : ''}
  `;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 5000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Tasks API ---
async function loadTasks() {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(userId)}`);
    if (!res.ok) return;
    const ct = res.headers.get('content-type');
    if (!ct?.includes('application/json')) return;

    const data = await res.json();
    const tasks = data.tasks || [];
    tasksCount.textContent = tasks.length;

    if (tasks.length === 0) {
      tasksContainer.innerHTML = '<div class="empty-state">Все още няма задачи</div>';
      return;
    }

    tasksContainer.innerHTML = tasks
      .map(
        (t) => `
      <div class="task-item" data-id="${t.id}">
        <div class="task-check" data-id="${t.id}" aria-label="Маркирай като готова">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="task-body">
          <div class="task-text">${escapeHtml(t.content)}</div>
          <div class="task-info">
            ${t.emotion ? `<span>${escapeHtml(t.emotion)}</span>` : ''}
            ${t.due_date ? `<span>${escapeHtml(t.due_date)}</span>` : ''}
          </div>
        </div>
      </div>`
      )
      .join('');
  } catch (e) {
    console.error('loadTasks:', e);
  }
}

async function markDone(taskId) {
  try {
    await fetch(`${API_BASE}/api/tasks/${taskId}/done`, { method: 'PATCH' });
    loadTasks();
  } catch (e) {
    console.error('markDone:', e);
  }
}

async function persistTask(args) {
  const res = await fetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      task: args.task,
      emotion: args.emotion,
      priority: args.priority,
      due_date: args.due_date,
      estimated_minutes: args.estimated_minutes,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Грешка при запис');
  showToast(data.task);
  loadTasks();
  return { success: true, task_id: data.task.id, content: data.task.content };
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
        setStatus(`„${message.data.text}"`, true);
      }
      break;

    case MultimodalLiveResponseType.TOOL_CALL: {
      const functionResponses = [];
      for (const call of message.data.functionCalls || []) {
        if (call.name === 'save_task') {
          try {
            const result = await persistTask(call.args || {});
            functionResponses.push({
              id: call.id,
              name: call.name,
              response: { result },
            });
          } catch (e) {
            functionResponses.push({
              id: call.id,
              name: call.name,
              response: { error: e.message || 'Грешка при запис' },
            });
          }
        } else {
          try {
            const result = client.callFunction(call.name, call.args || {});
            functionResponses.push({
              id: call.id,
              name: call.name,
              response: { result: result ?? 'ok' },
            });
          } catch (e) {
            functionResponses.push({
              id: call.id,
              name: call.name,
              response: { error: e.message },
            });
          }
        }
      }
      if (functionResponses.length) client.sendToolResponse(functionResponses);
      break;
    }

    case MultimodalLiveResponseType.INTERRUPTED:
      if (audioPlayer) audioPlayer.interrupt();
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Грешка ${res.status}`);
  if (!data.token) throw new Error('Невалиден токен');
  return data.token;
}

async function connectSession() {
  if (isConnecting || isSessionActive) return;
  isConnecting = true;
  recordBtn.disabled = true;
  setStatus('Свързване...', true);

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Микрофонът не се поддържа в този браузър');
    }

    const token = await fetchToken();

    client = new GeminiLiveAPI(token, LIVE_MODEL);
    client.systemInstructions = SYSTEM_INSTRUCTIONS;
    client.inputAudioTranscription = true;
    client.responseModalities = ['AUDIO'];
    client.voiceName = 'Kore';
    client.temperature = 1.0;
    client.automaticActivityDetection = {
      disabled: false,
      silence_duration_ms: 2000,
      prefix_padding_ms: 500,
      end_of_speech_sensitivity: 'END_SENSITIVITY_UNSPECIFIED',
      start_of_speech_sensitivity: 'START_SENSITIVITY_UNSPECIFIED',
    };
    client.addFunction(new SaveTaskTool());

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
  recordBtn.classList.remove('recording');
  recordBtn.disabled = false;
  recordBtn.setAttribute('aria-label', 'Запис');
  waveform.classList.remove('active');
  setStatus('Докоснете за запис');
}

// --- Events ---
recordBtn.addEventListener('click', () => {
  if (isSessionActive || isConnecting) {
    disconnectSession();
  } else {
    connectSession();
  }
});

tasksContainer.addEventListener('click', (e) => {
  const check = e.target.closest('.task-check');
  if (!check) return;
  const id = check.dataset.id;
  const item = check.closest('.task-item');
  if (item) {
    item.style.opacity = '0';
    item.style.transform = 'translateX(20px)';
    item.style.transition = 'all 0.3s ease';
  }
  setTimeout(() => markDone(id), 300);
});

loadTasks();
