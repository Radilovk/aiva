const API_BASE = '';

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
let mediaRecorder = null;
let audioChunks = [];

async function startDictation() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      setStatus('Обработвам...', true);
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      try {
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (data.text) {
          // Вмъкни текста в полето за задача
          const input = document.getElementById('task-input');
          if (input) {
            input.value += (input.value ? ' ' : '') + data.text;
          }
        }
      } catch (err) {
        console.error('Dictation error:', err);
        showError('Грешка при транскрипция');
      } finally {
        setStatus('Докоснете за запис');
      }

      // Спри микрофона
      stream.getTracks().forEach(t => t.stop());
    };

    mediaRecorder.start();
    isRecording = true;
    recordBtn.classList.add('recording');
    waveform.classList.add('active');
    setStatus('Записвам...', true);
  } catch (err) {
    console.error('Mic error:', err);
    showError('Няма достъп до микрофона');
  }
}

function stopDictation() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  recordBtn.classList.remove('recording');
  waveform.classList.remove('active');
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

// --- Manual Task Saving ---
async function saveManualTask() {
  const input = document.getElementById('task-input');
  if (!input) return;
  const taskText = input.value.trim();
  if (!taskText) return;

  try {
    const res = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        task: taskText,
        emotion: 'neutral',
        priority: 3,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.task);
      input.value = '';
      loadTasks();
    } else {
      showError(data.error || 'Грешка при запис');
    }
  } catch (e) {
    showError('Грешка при запис');
  }
}

// --- Events ---
recordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopDictation();
  } else {
    startDictation();
  }
});

document.getElementById('addTaskBtn')?.addEventListener('click', saveManualTask);
document.getElementById('task-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveManualTask();
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
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Init ---
loadTasks();
