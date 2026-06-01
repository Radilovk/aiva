const API_BASE = '';  // Same origin when served from Worker
const WS_BASE = location.protocol === 'https:' ? 'wss://' : 'ws://';

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

// --- DOM Elements ---
const recordBtn = document.getElementById('recordBtn');
const statusEl = document.getElementById('status');
const taskConfirmation = document.getElementById('taskConfirmation');
const taskContent = document.getElementById('taskContent');
const taskEmotion = document.getElementById('taskEmotion');
const taskPriority = document.getElementById('taskPriority');
const taskDue = document.getElementById('taskDue');
const tasksContainer = document.getElementById('tasksContainer');

// --- State ---
let isRecording = false;
let ws = null;
let audioContext = null;
let mediaStream = null;
let processorNode = null;
let playbackContext = null;

// --- Audio Playback ---
function initPlayback() {
  if (!playbackContext) {
    playbackContext = new AudioContext({ sampleRate: 24000 });
  }
}

function playAudioChunk(base64Data) {
  initPlayback();

  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  // Convert 16-bit PCM to Float32
  const samples = new Float32Array(bytes.length / 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }

  const buffer = playbackContext.createBuffer(1, samples.length, 24000);
  buffer.getChannelData(0).set(samples);

  const source = playbackContext.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackContext.destination);
  source.start();
}

// --- WebSocket Connection ---
function connectWebSocket() {
  const wsUrl = `${WS_BASE}${location.host}/ws/voice?user_id=${encodeURIComponent(userId)}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setStatus('Свързан — говорете...', true);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'audio') {
        playAudioChunk(msg.data);
      }

      if (msg.type === 'taskSaved') {
        showTaskConfirmation(msg.task);
        loadTasks();
      }

      if (msg.type === 'turnComplete') {
        // Gemini finished speaking
      }
    } catch (e) {
      console.error('WS message parse error:', e);
    }
  };

  ws.onclose = () => {
    setStatus('Връзката е прекъсната');
    stopRecording();
  };

  ws.onerror = (e) => {
    console.error('WS error:', e);
    setStatus('Грешка при свързване');
  };
}

// --- Audio Recording ---
async function startRecording() {
  try {
    audioContext = new AudioContext({ sampleRate: 16000 });
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const source = audioContext.createMediaStreamSource(mediaStream);

    // Use ScriptProcessorNode for PCM capture
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    processorNode.onaudioprocess = (event) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const inputData = event.inputBuffer.getChannelData(0);
      // Convert Float32 to Int16
      const int16Data = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // Send as base64 JSON
      const base64 = arrayBufferToBase64(int16Data.buffer);
      ws.send(JSON.stringify({
        type: 'audio',
        data: base64,
      }));
    };

    source.connect(processorNode);
    processorNode.connect(audioContext.destination);

    connectWebSocket();
    isRecording = true;
    recordBtn.classList.add('recording');
    setStatus('Слушам...', true);
  } catch (err) {
    console.error('Microphone error:', err);
    setStatus('Грешка: няма достъп до микрофона');
  }
}

function stopRecording() {
  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    ws = null;
  }

  isRecording = false;
  recordBtn.classList.remove('recording');
  setStatus('Натиснете бутона за запис');
}

// --- UI Helpers ---
function setStatus(text, active = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('active', active);
}

function showTaskConfirmation(task) {
  taskContent.textContent = task.content;
  taskEmotion.textContent = `🎭 ${task.emotion || 'neutral'}`;
  taskPriority.textContent = `⚡ Приоритет ${task.priority}`;
  taskDue.textContent = task.due_date ? `📅 ${task.due_date}` : '';
  taskConfirmation.classList.add('visible');

  setTimeout(() => {
    taskConfirmation.classList.remove('visible');
  }, 8000);
}

// --- Tasks List ---
async function loadTasks() {
  try {
    const res = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(userId)}`);
    const data = await res.json();

    tasksContainer.innerHTML = '';
    if (data.tasks && data.tasks.length > 0) {
      data.tasks.forEach((task) => {
        const el = document.createElement('div');
        el.className = 'task-item';
        el.innerHTML = `
          <div class="task-text">${escapeHtml(task.content)}</div>
          <button class="done-btn" data-id="${task.id}" aria-label="Готово"></button>
        `;
        tasksContainer.appendChild(el);
      });
    } else {
      tasksContainer.innerHTML = '<p style="color:#555;font-size:0.9rem;">Няма активни задачи</p>';
    }
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

// --- Event Listeners ---
recordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

tasksContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('done-btn')) {
    const id = e.target.dataset.id;
    markDone(id);
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
loadTasks();
