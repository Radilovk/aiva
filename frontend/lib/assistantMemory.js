/**
 * Persistent assistant memory — local + cloud sync, editable via Gemini tools.
 */
(function () {
  const STORAGE_KEY = 'aiva_assistant_memory_v1';
  const MAX_ENTRIES = 80;
  const MAX_CONTENT_LEN = 2000;
  const MAX_KEY_LEN = 80;

  function getApiBase() {
    return window.AIVA_CONFIG?.API_BASE || 'https://aiva.radilov-k.workers.dev';
  }

  function getUserId() {
    return window.AIVA_USER_ID
      || window.localStorage?.getItem?.('aiva_user_id')
      || 'anonymous';
  }

  function normalizeKey(key) {
    return String(key || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .slice(0, MAX_KEY_LEN);
  }

  function loadLocal() {
    try {
      const raw = JSON.parse(window.localStorage?.getItem?.(STORAGE_KEY) || 'null');
      if (raw?.entries && Array.isArray(raw.entries)) return raw;
    } catch (_e) { /* corrupt */ }
    return { entries: [], updatedAt: null };
  }

  function saveLocal(store) {
    store.updatedAt = new Date().toISOString();
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('aiva:memory-updated', { detail: store }));
    return store;
  }

  async function syncToCloud(store) {
    const userId = getUserId();
    if (!userId || userId === 'anonymous') return false;
    try {
      const res = await fetch(`${getApiBase()}/api/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, entries: store.entries, updated_at: store.updatedAt }),
      });
      return res.ok;
    } catch (_e) {
      return false;
    }
  }

  async function fetchFromCloud() {
    const userId = getUserId();
    if (!userId || userId === 'anonymous') return null;
    try {
      const res = await fetch(`${getApiBase()}/api/memory?user_id=${encodeURIComponent(userId)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data.entries)) return null;
      return { entries: data.entries, updatedAt: data.updated_at || null };
    } catch (_e) {
      return null;
    }
  }

  async function hydrate() {
    const local = loadLocal();
    const remote = await fetchFromCloud();
    if (!remote) return local;
    if (!local.updatedAt || (remote.updatedAt && remote.updatedAt > local.updatedAt)) {
      return saveLocal(remote);
    }
    if (local.updatedAt && (!remote.updatedAt || local.updatedAt > remote.updatedAt)) {
      syncToCloud(local);
    }
    return local;
  }

  function syncInBackground() {
    hydrate().catch(() => {});
  }

  function findEntry(store, key) {
    const k = normalizeKey(key);
    return store.entries.find((e) => normalizeKey(e.key) === k);
  }

  async function listEntries(category) {
    const store = loadLocal();
    let entries = store.entries;
    if (category) {
      const cat = String(category).trim().toLowerCase();
      entries = entries.filter((e) => String(e.category || '').toLowerCase() === cat);
    }
    return { ok: true, entries, count: entries.length };
  }

  async function upsertEntry({ key, content, category = 'general', source = 'assistant' }) {
    const k = normalizeKey(key);
    const body = String(content || '').trim();
    if (!k) return { ok: false, error: 'key required' };
    if (!body) return { ok: false, error: 'content required' };
    if (body.length > MAX_CONTENT_LEN) {
      return { ok: false, error: `content max ${MAX_CONTENT_LEN} chars` };
    }

    const store = loadLocal();
    const now = new Date().toISOString();
    const existing = findEntry(store, k);
    if (existing) {
      existing.content = body;
      existing.category = category || existing.category || 'general';
      existing.source = source;
      existing.updatedAt = now;
    } else {
      if (store.entries.length >= MAX_ENTRIES) {
        store.entries.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
        store.entries.shift();
      }
      store.entries.push({
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        key: k,
        content: body,
        category: category || 'general',
        source,
        updatedAt: now,
      });
    }
    saveLocal(store);
    syncToCloud(store);
    return { ok: true, key: k, action: existing ? 'updated' : 'created' };
  }

  async function deleteEntry({ key, id }) {
    const store = loadLocal();
    const before = store.entries.length;
    if (id) {
      store.entries = store.entries.filter((e) => e.id !== id);
    } else if (key) {
      const k = normalizeKey(key);
      store.entries = store.entries.filter((e) => normalizeKey(e.key) !== k);
    } else {
      return { ok: false, error: 'key or id required' };
    }
    if (store.entries.length === before) {
      return { ok: false, error: 'not found' };
    }
    saveLocal(store);
    syncToCloud(store);
    return { ok: true, deleted: before - store.entries.length };
  }

  function formatForSettings(store) {
    if (!store?.entries?.length) return '';
    return store.entries
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((e) => `- [${e.key}] (${e.category || 'general'}): ${e.content}`)
      .join('\n');
  }

  function parseSettingsText(text) {
    const entries = [];
    for (const line of String(text || '').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^-\s*\[([^\]]+)\]\s*\(([^)]+)\):\s*(.+)$/);
      if (!match) continue;
      entries.push({
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        key: normalizeKey(match[1]),
        category: match[2].trim().slice(0, 40) || 'general',
        content: match[3].trim().slice(0, MAX_CONTENT_LEN),
        source: 'assistant',
        updatedAt: new Date().toISOString(),
      });
    }
    return entries.slice(0, MAX_ENTRIES);
  }

  async function importFromSettingsText(text) {
    const entries = parseSettingsText(text);
    const store = saveLocal({ entries, updatedAt: null });
    syncToCloud(store);
    return { ok: true, count: entries.length };
  }

  function formatForPrompt(store) {
    if (!store?.entries?.length) {
      return 'ПОСТОЯННА ПАМЕТ (празна): можеш да записваш факти с memory_save.';
    }
    const lines = store.entries
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 40)
      .map((e) => `- [${e.key}] (${e.category || 'general'}): ${e.content}`);
    return `ПОСТОЯННА ПАМЕТ (редактирай с memory_save / memory_delete):\n${lines.join('\n')}`;
  }

  function buildPromptSectionSync() {
    return formatForPrompt(loadLocal());
  }

  async function buildPromptSection() {
    return buildPromptSectionSync();
  }

  function createTool(name, description, properties, required = []) {
    class MemoryTool extends FunctionCallDefinition {
      constructor() {
        super(name, description, { type: 'object', properties }, required);
      }
      functionToCall() {
        return 'pending';
      }
    }
    return new MemoryTool();
  }

  function getGeminiTools() {
    return [
      createTool(
        'memory_list',
        'Чете постоянната памет. Филтрирай по category: user, preference, device, work, general.',
        { category: { type: 'string', description: 'Опционална категория' } },
        []
      ),
      createTool(
        'memory_save',
        'Записва или обновява факт в постоянната памет (по key). НЕ променя потребителските насоки от настройките — само факти за потребителя.',
        {
          key: { type: 'string', description: 'Кратък идентификатор, напр. preferred_call_time' },
          content: { type: 'string', description: 'Текст за запомняне' },
          category: {
            type: 'string',
            enum: ['user', 'preference', 'device', 'work', 'general'],
          },
        },
        ['key', 'content']
      ),
      createTool(
        'memory_delete',
        'Изтрива запис от постоянната памет по key или id.',
        {
          key: { type: 'string', description: 'Ключ за изтриване' },
          id: { type: 'string', description: 'Или id на записа' },
        },
        []
      ),
    ];
  }

  async function handleTool(name, args) {
    const a = args || {};
    switch (name) {
      case 'memory_list':
        return listEntries(a.category);
      case 'memory_save':
        return upsertEntry({
          key: a.key,
          content: a.content,
          category: a.category || 'general',
          source: 'assistant',
        });
      case 'memory_delete':
        return deleteEntry({ key: a.key, id: a.id });
      default:
        return { ok: false, error: `unknown memory tool: ${name}` };
    }
  }

  window.AIVA_MEMORY = {
    hydrate,
    syncInBackground,
    loadLocal,
    listEntries,
    upsertEntry,
    deleteEntry,
    importFromSettingsText,
    formatForSettings,
    buildPromptSection,
    buildPromptSectionSync,
    formatForPrompt,
    getGeminiTools,
    handleTool,
  };
})();
