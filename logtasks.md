# AIVA — Лог на задачите

## 2026-06-09: Fix — гласовите команди не създават/изтриват задачи при включен Google Grounding

### Проблем
Чрез гласова команда не могат да се създават и изтриват задачи (нито редакция/маркиране), въпреки че инструментите `save_task`, `delete_task`, `edit_task` и др. са регистрирани.

### Причина (потвърдена)
В `frontend/lib/geminilive.js` при включен `googleGrounding` (по подразбиране `true` в `settings.js`) `sendInitialSetupMessages()` презаписваше целия `setup.tools` само с `[{ googleSearch: {} }]`, премахвайки всички `functionDeclarations`. Така моделът няма достъп до инструментите за задачи и не може да създава/изтрива нищо. Gemini Live API поддържа едновременно `googleSearch` и `functionDeclarations` в един масив `tools`.

### Решение
`googleSearch` се добавя към съществуващите `functionDeclarations` вместо да ги заменя — пълен достъп до задачите (създаване, редакция, изтриване) се запазва и при включено търсене.


## 2026-06-07: Fix — APK не записва/слуша + синхронизация с календара на устройството

### Проблем
1. APK не успява да включи запис/слушане, докато web версията работи.
2. Синхронизацията трябва да ползва календара на самото устройство.

### Причина (потвърдена)
- Capacitor `BridgeWebChromeClient.onPermissionRequest` автоматично иска `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` при `getUserMedia`, но Android ги отказва веднага, ако не са декларирани в `AndroidManifest.xml`. Скриптът `android-res/patch-local-notifications.py` добавяше само нотификационни пермисии → `getUserMedia` се отказва в WebView → запис/слушане не работи в APK (на web няма този слой). Потвърдено в изходния код на Capacitor: `request.deny()` при липсваща пермисия.

### Решение
1. **Микрофон**: добавени `RECORD_AUDIO` и `MODIFY_AUDIO_SETTINGS` в `patch-local-notifications.py` (вкл. idempotent клон за вече патчнати манифести).
2. **Календар на устройството** (без нови native плъгини):
   - `frontend/lib/deviceCalendar.js` — изгражда single-event ICS и го подава на календарното приложение на устройството чрез Web Share API (files); fallback към сваляне/отваряне на `.ics`.
   - Бутон „📅 Календар" в модала за задача (`index.html` + `app.js`).
   - Нова опция „Календар на устройството" в настройките (`settings.html`).

## 2026-06-03: Fix — AudioWorklet грешка при инициализация + SyntaxError при зареждане на задачи

### Проблем
1. **Workers (https://aiva.radilov-k.workers.dev/)**: `app.js:374 Mic error: InvalidStateError: Failed to construct 'AudioWorkletNode': AudioWorkletNode cannot be created: AudioWorklet does not have a valid AudioWorkletGlobalScope. Load a script via audioWorklet.addModule() first.`
2. **GitHub/локален файл**: `app.js:450 Load tasks error: SyntaxError: Unexpected token '<'`

### Причина
1. **AudioWorklet грешка**: Кодът се опитваше да създаде `AudioWorkletNode` преди да провери дали `addModule()` е наистина успял. При грешка в зареждането на модула, `useWorklet` оставаше `false` от try-catch блока, но поради неправилна логика (проверката `if (useWorklet)` беше СЛЕД `connectGemini`, но се създаваше преди try-catch да завърши), се опитваше да създаде worklet node дори когато модулът не е зареден.
2. **SyntaxError**: При отваряне на `index.html` директно (не през Worker), `API_BASE` е празен, `fetch('/api/tasks/...')` връща HTML (404 страница от GitHub или локален сървър), а кодът се опитва да парсва HTML като JSON → `SyntaxError: Unexpected token '<'`.

### Решение
1. **AudioWorklet**: Преместен цялата логика за създаване на `AudioWorkletNode` в `try-catch` блока, като и двете операции (`addModule` и `new AudioWorkletNode`) се изпълняват заедно. Флагът `workletSuccess` се сетва само ако И ДВЕТЕ операции успеят. При грешка се използва ScriptProcessor fallback.
2. **loadTasks**: Добавена проверка на HTTP статус и Content-Type преди опит за парсване като JSON. Ако отговорът не е успешен (non-200) или не е JSON, функцията връща ранно без да се опитва да парсва.

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

---

## 2026-06-02: Fix — Cloudflare деплой грешка: "does not export class 'VoiceWebSocket'" (code: 10064)

### Проблем
- `New version of script does not export class 'VoiceWebSocket' which is depended on by existing Durable Objects` [code: 10064]
- Деплойът се проваля — Cloudflare пази запис за `VoiceWebSocket` като Durable Object клас от предишна версия

### Причина (потвърдена)
- `VoiceWebSocket` Durable Object класът е бил регистриран в Cloudflare в по-ранна версия
- При прехода към директна Gemini WebSocket връзка, класът е премахнат без `delete-class` migration
- Cloudflare изисква изрична миграция при премахване на Durable Object клас

### Решение
- Добавена `"migrations"` секция в `wrangler.jsonc` с `"deleted_classes": ["VoiceWebSocket"]` и tag `"v1"`
- Добавен stub `VoiceWebSocket` клас в `index.ts` (Cloudflare изисква класът да е наличен при деплоя с миграцията)
- Добавен `durable_objects.bindings` в `wrangler.jsonc` за да може wrangler да асоциира миграцията с binding-а
- **След успешен деплой**: премахни stub класа и `durable_objects` секцията от конфига

## 2026-06-02: Fix — "Token generation failed: " (празно error тяло)

### Проблем
- `POST /api/token` връща 500 с лог `Token generation failed: ` (празно съобщение)
- Gemini API отговаря с non-OK статус и празно тяло

### Причина
- Невалидно име на модел `gemini-3.1-flash-live-preview` — такъв модел не съществува в Google Gemini API
- Правилното име за Live API е `gemini-2.0-flash-live-001`

### Решение
- `workers/src/index.ts`: сменен модел от `gemini-3.1-flash-live-preview` на `gemini-2.0-flash-live-001` в URL за `generateEphemeralToken`
- `frontend/app.js`: сменен модел в setup съобщението към Gemini WebSocket
- Обновен `README.md` с коректното име на модела

---

## 2026-06-03: Fix — "Неуспешно генериране на токен" (модел gemini-2.0-flash-live-001 спрян)

### Проблем
- При натискане на бутона за гласово въвеждане се показва "Неуспешно генериране на токен"
- `POST /api/token` връща 500

### Причина (потвърдена)
- Моделът `gemini-2.0-flash-live-001` е **officially deprecated и спрян на 1 юни 2026** от Google
- Потребителят е в Европа с предплатен ключ — моделът вече не съществува в API-то
- `generateEphemeralToken` endpoint-ът връща грешка за несъществуващ модел

### Решение
- `workers/src/index.ts`: сменен модел от `gemini-2.0-flash-live-001` на `gemini-2.5-flash` в URL за `generateEphemeralToken`
- `frontend/app.js`: сменен модел в setup съобщението от `models/gemini-2.0-flash-live-001` на `models/gemini-2.5-flash`
- `gemini-2.5-flash` е наличен в списъка с модели на потребителя и поддържа Live API

---

## 2026-06-03: Fix — "Token generation failed: " (празно error тяло, endpoint не съществува)

### Проблем
- `POST /api/token` продължава да връща 500 с `Token generation failed: ` (празно error тяло)
- Gemini API отговаря с non-OK статус и празно тяло

### Причина (потвърдена чрез изходния код на googleapis/python-genai SDK и google-gemini/gemini-live-api-examples)
- **Endpoint-ът `models/{model}:generateEphemeralToken` НЕ СЪЩЕСТВУВА** в Google Generative Language API
- Предишният "fix" само сменяше модела, но самият REST метод `:generateEphemeralToken` никога не е бил валиден
- Правилният endpoint за издаване на auth token е `POST /v1alpha/auth_tokens` (не `/v1beta/models/...`)
- SDK-то (`googleapis/python-genai`) вътрешно вика `POST auth_tokens` с `api_version: v1alpha`
- WebSocket endpoint-ът за auth tokens е `BidiGenerateContentConstrained` (v1alpha), не `BidiGenerateContent` (v1beta)
- Правилното име на модела за Live API с аудио е `gemini-2.5-flash-preview-native-audio-dialog`

### Решение
- `workers/src/index.ts`:
  - Сменен endpoint от `/v1beta/models/gemini-2.5-flash:generateEphemeralToken` на `/v1alpha/auth_tokens`
  - Request body: `{ uses: 1, expireTime, newSessionExpireTime }` (вместо невалидния `config` обект)
  - Response: връща `{ token: data.name, expires_at }` (auth token name)
- `frontend/app.js`:
  - WebSocket URL: `v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`
  - Модел: `models/gemini-2.5-flash-preview-native-audio-dialog`

### Източници
- `googleapis/python-genai` → `google/genai/tokens.py` (path = 'auth_tokens', api_version = 'v1alpha')
- `google-gemini/gemini-live-api-examples` → `gemini-live-ephemeral-tokens-websocket/frontend/geminilive.js`

---

## 2026-06-07: Имплементация на план за нови функции

### Задача
Пълна имплементация на 6-точковия план за нови функции на AIVA:
1. Синхронизация с календар + настройки
2. Гласово управление на задачи (четене/редакция/изтриване)
3. Обсъждане на задачи + интернет достъп
4. Нотификации
5. APK + PWA пакетиране
6. Допълнителни оптимизации

### Какво е направено

#### PWA (Progressive Web App)
- [x] `frontend/manifest.json` — PWA манифест с име, икони, тема, standalone режим
- [x] `frontend/sw.js` — Service Worker за офлайн кеширане + push нотификации
- [x] `frontend/icons/icon-192.png`, `icon-512.png` — PWA икони
- [x] Регистрация на SW в `index.html`
- [x] Мета тагове за PWA (manifest link, apple-touch-icon)

#### Гласови команди (Gemini function declarations)
- [x] `read_tasks` — чете задачи за ден/утре/седмица/всички
- [x] `edit_task` — редактира задача по ID или текстово търсене
- [x] `delete_task` — изтрива задача с потвърждение
- [x] `mark_task_done` — маркира задача като завършена
- [x] `discuss_task` — обсъжда задача с интернет достъп (Google Grounding)
- [x] Обновени `systemInstructions` с инструкции за всички нови команди
- [x] Confirmation flow за изтриване/редактиране

#### Google Grounding
- [x] Активиран `googleGrounding: true` по подразбиране
- [x] Интегриран в `discuss_task` за реални интернет съвети

#### Настройки (settings.html)
- [x] Пълна страница с UI за конфигуриране
- [x] Секции: Нотификации, Синхронизация с календар, Гласов асистент, Календар, Стойности по подразбиране, Безопасност, Външен вид, Данни
- [x] Toggle компоненти за бързо включване/изключване
- [x] Експорт/Импорт на данни (JSON backup)
- [x] ICS URL за абониране с календар
- [x] Линк от главната страница

#### Нотификации
- [x] `frontend/local-scheduler.js` — notification scheduler (Capacitor + PWA fallback)
- [x] SW push notification handler с action бутони (Отвори / Готово ✓)
- [x] Настройки за нотификации (мин преди, тихи часове, звук)
- [x] Автоматично планиране при зареждане на задачи

#### Backend
- [x] `GET /api/tasks/:user_id/search?q=...` — търсене на задачи за voice commands
- [x] `GET /api/calendar.ics?user_id=...` — ICS calendar feed за webcal:// абониране
- [x] `POST /api/push/subscribe` — запис на push subscription
- [x] `searchTasks()`, `getTasksForDate()`, `getUpcomingTasks()` функции в tasks.ts

#### Capacitor APK
- [x] `capacitor.config.json` — конфигурация за `com.aiva.assistant`
- [x] `.github/workflows/build-apk.yml` — CI/CD pipeline за автоматичен APK build
- [x] `android-res/patch-local-notifications.py` — патч за AndroidManifest (пермисии + receiver)
- [x] `android-res/java/.../AivaNotificationReceiver.java` — BroadcastReceiver за action бутони
- [x] `android-res/proguard-rules.pro` — ProGuard конфигурация
- [x] `.gitignore` обновен за android/ и capacitor-shell/
