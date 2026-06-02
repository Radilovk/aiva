# AIVA — Лог на задачите

## 2026-06-02: Fix — bindings изчезват след деплой + грешка при зареждане на задачи

### Проблем
- `app.js:316 Load tasks error: SyntaxError: Unexpected token '<'` — фронтендът получавал HTML вместо JSON от `/api/tasks/...`
- Bindings (D1, KV) изчезвали след всеки деплой

### Причина
- Root `wrangler.jsonc` нямал `main` поле → при деплой се качват само статичните assets без Worker код
- Без Worker — `/api/*` пренасочва към `index.html` (HTML), което счупва `res.json()`
- При всеки деплой без декларирани bindings в `wrangler.jsonc` — Cloudflare ги трие от dashboard-а

### Решение
- Добавени в `wrangler.jsonc`: `main: "workers/src/index.ts"`, D1 binding, KV binding, cron trigger
- Взети от `workers/wrangler.toml` (database_id, kv id остават същите)

## 2026-06-02: Fix — 500 на /ws/voice и HTML отговор от /api/tasks

### Проблем
- `GET /ws/voice` → HTTP 500, `wallTimeMs: 30178` (30 сек timeout)
- `app.js:316 Load tasks error: SyntaxError: Unexpected token '<'` — HTML вместо JSON

### Причина
- `GEMINI_WS_URL` използваше `wss://` схема, но Cloudflare Workers `fetch()` изисква `https://` за изходящи WebSocket връзки — `fetch('wss://...')` виси 30 сек и хвърля изключение
- Нямаше try-catch около `fetch(GEMINI_WS_URL)` → неуловено изключение → Hono връща 500
- `/api/tasks/:user_id` нямаше try-catch → при DB грешка Cloudflare сервира HTML error page вместо JSON

### Решение
- `wss://` → `https://` в `GEMINI_WS_URL`
- Добавен try-catch около `fetch(GEMINI_WS_URL)` — при грешка праща `type: 'error'` на WebSocket клиента и затваря с 1011
- Добавен try-catch в `/api/tasks/:user_id` — връща `{ tasks: [] }` с 500 вместо HTML

---

## 2026-06-02: Подобрения от Gemini Live API примерите + Cost Protection

### Фаза 1: Cost Protection
- [x] Добавен `maxOutputTokens: 1024` в generationConfig на WebSocket setup — ограничава дължината на отговорите
- [x] Добавен session timeout (автоматично затваряне след 3 мин неактивност) — спестява API секунди
- [x] Добавен rate limit: макс. 20 сесии/ден per user чрез KV — предпазва от неочаквани разходи
- [x] Кеширане на cron резултата в KV — ако задачите не са се променили, не прави нова Gemini заявка
- [x] Добавен `maxOutputTokens: 512` в cron generationConfig

### Фаза 2: Function Calling (от Google gemini-live-api-examples)
- [x] Заменено JSON парсването с Gemini function declaration за `save_task` — надежден структуриран output
- [x] Добавен `automaticActivityDetection` в setup message — по-добро разпознаване на края на речта

### Фаза 3: Audio подобрения (от Google gemini-live-api-examples)
- [x] Заменен ScriptProcessor с AudioWorklet (+ fallback) — по-ниска латентност, по-малко CPU
- [x] Добавен input transcription — текстов fallback показван в UI

### Технически детайли
- Използван модел от Google примера: `automaticActivityDetection` с `silenceDurationMs: 2000`, `prefixPaddingMs: 500`
- Function calling елиминира нестабилното JSON парсване от свободен текст
- AudioWorklet процесор създаден в `frontend/pcm-processor.js`
- Rate limiting използва KV с TTL 24ч (автоматично изтичане)
- Cron кеш сравнява hash на task IDs — ново извикване само при промяна в задачите

---

## 2026-06-02: Fix — "Gemini WS error: [object ErrorEvent]"

### Проблем
- Логовете показват `Gemini WS error: [object ErrorEvent]` — без полезна информация за реалната грешка

### Причина
- `console.error('Gemini WS error:', e)` предава `ErrorEvent` обекта директно → `.toString()` го превръща в `[object ErrorEvent]`
- Реалното съобщение за грешка е в `e.message` и `e.error`, но не се извличат

### Решение
- Заменено с `console.error('Gemini WS error:', ev.message || ev.type, ev.error)` — извлича конкретното съобщение

---

## 2026-06-02: Fix — "Network connection lost" / Stateless Worker не може да проксира WebSocket

### Проблем
- `Gemini WS error: Uncaught Error: Network connection lost.` + `"outcome": "canceled"`
- Гласовата функция никога не работи повече от секунди

### Причина (потвърдена)
- Cloudflare Workers в `"executionModel": "stateless"` **не може да поддържа дълготрайни изходящи WebSocket връзки**
- Stateless worker се отменя от runtime-а, което разкъсва TCP връзката към Gemini → `"Network connection lost."`
- Worker проксирането на WebSocket изисква Durable Objects (stateful execution)

### Решение
- Премахнат `/ws/voice` WebSocket proxy endpoint и целия свързан код (handleFunctionCallSaveTask, arrayBufferToBase64, SESSION_TIMEOUT_MS)
- `POST /api/token` сега приема `user_id` в body и извършва rate limiting преди да издаде токен
- Добавен `POST /api/tasks` REST endpoint — фронтендът го вика директно след toolCall от Gemini
- `frontend/app.js`: `connectWebSocket()` заменен с `connectGemini()` — браузърът се свързва **директно** с Gemini Live API WebSocket чрез ephemeral token
- Аудио се изпраща директно в Gemini формат (`realtimeInput.mediaChunks`), без Worker-посредник
- `handleSaveTask()` в JS прихваща `toolCall` от Gemini и вика `POST /api/tasks` на Worker-а

### Архитектура след поправката
```
Браузър ←→ Gemini Live API WebSocket (директно, с ephemeral token)
Браузър → Worker POST /api/token (вземане на токен + rate limiting)
Браузър → Worker POST /api/tasks (запис на задача след toolCall)
```

