const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? ''
  : 'https://aiva.radilov-k.workers.dev';

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
let isRecording = false;
let ws = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let playbackQueue = [];
let isPlaying = false;
let playbackContext = null;

// --- Audio Playback with queue (handles variable sample rates) ---
function getPlaybackContext() {
  if (!playbackContext || playbackContext.state === 'closed') {
    try {
      playbackContext = new AudioContext({ sampleRate: 24000 });
    } catch {
      // Fallback: let browser pick sample rate, we'll resample
      playbackContext = new AudioContext();
    }
  }
  if (playbackContext.state === 'suspended') {
    playbackContext.resume();
  }
  return playbackContext;
}

function playAudioChunk(base64Data) {
  const ctx = getPlaybackContext();
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // Convert 16-bit PCM to Float32
  const pcmSamples = new Float32Array(bytes.length / 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcmSamples.length; i++) {
    pcmSamples[i] = view.getInt16(i * 2, true) / 32768;
  }

  // Resample if AudioContext doesn't support 24kHz natively
  const targetRate = ctx.sampleRate;
  let finalSamples = pcmSamples;

  if (targetRate !== 24000) {
    const ratio = 24000 / targetRate;
    const newLength = Math.round(pcmSamples.length / ratio);
    finalSamples = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * ratio;
      const idx = Math.floor(srcIdx);
      const frac = srcIdx - idx;
      const a = pcmSamples[idx] || 0;
      const b = pcmSamples[idx + 1] || 0;
      finalSamples[i] = a + (b - a) * frac;
    }
  }

  const buffer = ctx.createBuffer(1, finalSamples.length, targetRate);
  buffer.getChannelData(0).set(finalSamples);

  playbackQueue.push(buffer);
  if (!isPlaying) drainPlaybackQueue(ctx);
}

function drainPlaybackQueue(ctx) {
  if (playbackQueue.length === 0) {
    isPlaying = false;
    return;
  }
  isPlaying = true;
  const buffer = playbackQueue.shift();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onended = () => drainPlaybackQueue(ctx);
  source.start();
}

// --- Direct Gemini WebSocket connection ---
async function connectGemini() {
  // Get ephemeral token with rate limiting
  let tokenData;
  try {
    const res = await fetch(`${API_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    tokenData = await res.json();
    if (!res.ok) {
      showError(tokenData.error || 'Грешка при получаване на токен');
      return null;
    }
  } catch (e) {
    showError('Грешка при свързване');
    return null;
  }

  const token = tokenData.token;
  if (!token) {
    showError('Невалиден токен от сървъра');
    return null;
  }

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;
  ws = new WebSocket(geminiUrl);

  ws.onopen = () => {
    console.log('Gemini WebSocket connected');
    console.log('Using model:', 'models/gemini-1.5-flash');
    // Send setup message directly to Gemini
    ws.send(JSON.stringify({
      setup: {
        model: 'models/gemini-1.5-flash',
        generationConfig: {
          maxOutputTokens: 1024,
          responseModalities: ['AUDIO', 'TEXT'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
        enableAffectiveDialog: true,
        inputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: false },
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
                    task: { type: 'STRING', description: 'Кратка формулировка на задачата на български' },
                    emotion: { type: 'STRING', description: 'Засечена емоция от тона на гласа', enum: ['stress', 'tired', 'urgent', 'neutral'] },
                    priority: { type: 'INTEGER', description: 'Приоритет от 1 (най-висок) до 5 (най-нисък)' },
                    due_date: { type: 'STRING', description: 'Краен срок във формат YYYY-MM-DD или празен ако няма' },
                    estimated_minutes: { type: 'INTEGER', description: 'Прогнозно време за изпълнение в минути' },
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
              text: `Ти си личен асистент за задачи на български език.\n\nПРАВИЛА:\n- Слушаш ТОНА на гласа, не само думите\n- Ако потребителят звучи стресирано → отговаряш спокойно и уверено\n- Ако звучи уморено → отговаряш много кратко\n- Ако звучи бързащо → веднага минаваш към същественото\n- Задаваш САМО ЕДИН въпрос\n- НИКОГА не задаваш повече от един въпрос\n- Говориш само на български\n- Когато разбереш задачата, ИЗВИКАЙ функцията save_task с правилните параметри`,
            },
          ],
        },
      },
    }));
  };

  ws.onmessage = async (event) => {
    console.log('Gemini WS message received:', event.data);
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      console.error('Failed to parse WS message:', e);
      return;
    }

    // Setup complete — connection ready
    if (data.setupComplete) {
      console.log('Gemini setup complete');
      setStatus('Слушам...', true);
      waveform.classList.add('active');
      return;
    }

    if (data.error) {
      console.error('Gemini error message:', data.error);
    }

    // Tool call — save task via Worker REST API
    if (data.toolCall) {
      for (const call of data.toolCall.functionCalls || []) {
        if (call.name === 'save_task') {
          await handleSaveTask(call);
        }
      }
      return;
    }

    // Audio / text from Gemini
    if (data.serverContent?.modelTurn?.parts) {
      for (const part of data.serverContent.modelTurn.parts) {
        if (part.inlineData) {
          playAudioChunk(part.inlineData.data);
        }
      }
    }

    // Input transcription
    if (data.serverContent?.inputTranscription) {
      const text = data.serverContent.inputTranscription.text || '';
      if (text) setStatus(`"${text}"`, true);
    }
  };

  ws.onclose = (ev) => {
    console.log(`WebSocket closed: ${ev.code} ${ev.reason}`);
    setStatus('Докоснете за запис');
    waveform.classList.remove('active');
    if (isRecording) stopRecording();
  };

  ws.onerror = (ev) => {
    console.error('Gemini WS error:', ev);
    showError('Грешка при свързване с Gemini');
  };

  return ws;
}

// --- Handle save_task function call from Gemini ---
async function handleSaveTask(call) {
  const args = call.args || {};
  let response;
  try {
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
    if (res.ok) {
      showToast(data.task);
      loadTasks();
      response = { success: true, task_id: data.task.id, content: data.task.content };
    } else {
      response = { error: data.error || 'Грешка при запис' };
    }
  } catch (e) {
    response = { error: 'Грешка при запис' };
  }
  // Send function response back to Gemini so it can confirm to the user
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      toolResponse: {
        functionResponses: [{ id: call.id, response }],
      },
    }));
  }
}

// --- Audio Recording (AudioWorklet with ScriptProcessor fallback) ---
async function startRecording() {
  try {
    // Resume any existing playback context (required by browsers on user gesture)
    getPlaybackContext();

    audioContext = new AudioContext({ sampleRate: 16000 });

    // Fallback if 16kHz not supported — resample from native rate
    const actualRate = audioContext.sampleRate;

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const source = audioContext.createMediaStreamSource(mediaStream);

    // Connect to Gemini before setting up audio pipeline
    const geminiWs = await connectGemini();
    if (!geminiWs) {
      if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
      if (audioContext) { audioContext.close(); audioContext = null; }
      return;
    }

    // Try AudioWorklet first, fallback to ScriptProcessor
    let workletSuccess = false;
    try {
      await audioContext.audioWorklet.addModule('pcm-processor.js');
      const worklet = new AudioWorkletNode(audioContext, 'pcm-processor');
      worklet.port.onmessage = (event) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: arrayBufferToBase64(event.data.pcm) }],
          },
        }));
      };
      source.connect(worklet);
      worklet.connect(audioContext.destination);
      workletNode = worklet;
      workletSuccess = true;
    } catch (e) {
      console.warn('AudioWorklet not supported, using ScriptProcessor fallback:', e);
    }

    if (!workletSuccess) {
      // ScriptProcessor fallback
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (event) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        let inputData = event.inputBuffer.getChannelData(0);

        // Resample to 16kHz if needed
        if (actualRate !== 16000) {
          const ratio = actualRate / 16000;
          const newLen = Math.floor(inputData.length / ratio);
          const resampled = new Float32Array(newLen);
          for (let i = 0; i < newLen; i++) {
            resampled[i] = inputData[Math.floor(i * ratio)];
          }
          inputData = resampled;
        }

        // Float32 → Int16
        const int16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: arrayBufferToBase64(int16.buffer) }],
          },
        }));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      workletNode = processor;
    }

    isRecording = true;
    recordBtn.classList.add('recording');
    setStatus('Свързване...', true);
  } catch (err) {
    console.error('Mic error:', err);
    showError('Няма достъп до микрофона');
  }
}

function stopRecording() {
  if (workletNode) { workletNode.disconnect(); workletNode = null; }
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  if (ws && ws.readyState === WebSocket.OPEN) { ws.close(); ws = null; }

  isRecording = false;
  recordBtn.classList.remove('recording');
  waveform.classList.remove('active');
  setStatus('Докоснете за запис');
}

// --- UI ---
function setStatus(text, active = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('active', active);
}

function showToast(task) {
  toastContent.textContent = task.content;

  const emotionMap = { stress: '😰', tired: '😴', urgent: '⚡', neutral: '😊' };
  const priorityLabel = `П${task.priority}`;
  const emotionText = escapeHtml(task.emotion || 'neutral');
  const dueLabel = escapeHtml(task.due_date || '');

  toastMeta.innerHTML = `
    <span>${emotionMap[task.emotion] || '😊'} ${emotionText}</span>
    <span>⚡ ${escapeHtml(priorityLabel)}</span>
    ${dueLabel ? `<span>📅 ${dueLabel}</span>` : ''}
  `;

  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 5000);
}

function showError(msg) {
  errorToast.textContent = msg;
  errorToast.classList.add('visible');
  setTimeout(() => errorToast.classList.remove('visible'), 4000);
}

// --- Tasks ---
async function loadTasks() {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(userId)}`);
    if (!res.ok) {
      console.warn('Failed to load tasks:', res.status);
      return;
    }
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('Tasks endpoint returned non-JSON response');
      return;
    }
    const data = await res.json();
    const tasks = data.tasks || [];

    tasksCount.textContent = tasks.length;

    if (tasks.length === 0) {
      tasksContainer.innerHTML = '<div class="empty-state">Все още няма задачи</div>';
      return;
    }

    tasksContainer.innerHTML = tasks.map((t) => `
      <div class="task-item" data-id="${t.id}">
        <div class="task-check" data-id="${t.id}" aria-label="Маркирай като готова">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="task-body">
          <div class="task-text">${escapeHtml(t.content)}</div>
          <div class="task-info">
            ${t.emotion ? `<span>${t.emotion}</span>` : ''}
            ${t.due_date ? `<span>${t.due_date}</span>` : ''}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Load tasks error:', e);
  }
}

async function markDone(taskId) {
  try {
    await fetch(`${API_BASE}/api/tasks/${taskId}/done`, { method: 'PATCH' });
    loadTasks();
  } catch (e) {
    console.error('Mark done error:', e);
  }
}

// --- Events ---
recordBtn.addEventListener('click', () => {
  console.log('Record button clicked');
  if (isRecording) {
    stopRecording();
  } else {
    startRecording().catch(err => {
      console.error('startRecording failed:', err);
    });
  }
});

tasksContainer.addEventListener('click', (e) => {
  const check = e.target.closest('.task-check');
  if (check) {
    const id = check.dataset.id;
    // Animate out
    const item = check.closest('.task-item');
    if (item) {
      item.style.opacity = '0';
      item.style.transform = 'translateX(20px)';
      item.style.transition = 'all 0.3s ease';
    }
    setTimeout(() => markDone(id), 300);
  }
});

// --- Utilities ---
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Init ---
console.log('AIVA initialized');
console.log('API_BASE:', API_BASE || '(relative)');
loadTasks();
