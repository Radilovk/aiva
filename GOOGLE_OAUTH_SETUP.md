# Google OAuth — настройка за създателя на KASY

Този документ е за **теб като собственик на приложението**, не за крайните потребители. Премахва екрана „Не сме потвърдили това приложение“, грешки при свързване на Google Calendar и объркване в конзолата на браузъра.

## Какво не е бъг в KASY

| Какво виждаш | Причина |
| --- | --- |
| **Self-XSS** предупреждение в DevTools | Стандартно съобщение на Chrome — не идва от приложението |
| **`loaded geminiLiveApi.js`**, **`Audio player initialized`** | Бяха debug логове — вече са скрити освен при `?debug=1` или `localStorage.aiva_debug=1` |
| **`/api/token`** | Токен за Gemini Live (глас), не за Google Calendar |

## Бърз чеклист

```bash
node scripts/google-oauth-setup.mjs
```

Скриптът отпечатва точните redirect URI и команди за secrets.

### 1. Google Cloud Console

1. Отвори [Google Cloud Console](https://console.cloud.google.com/) → проектът на KASY.
2. **APIs & Services → Enable APIs** → включи **Google Calendar API**.
3. **OAuth consent screen**
   - User type: **External**
   - App name, support email, logo (по желание)
   - Scopes: добави само `https://www.googleapis.com/auth/calendar.events` (View and edit events on all your calendars)
   - **За тестване:** Publishing status = **Testing** → добави имейлите на тестовите потребители под **Test users**
   - **За всички потребители:** Submit for **verification** (Google преглежда приложението; без това външните потребители виждат „непотвърдено приложение“)

> **Статус (авг. 2026):** OAuth verification е **одобрена** — публичните потребители могат да свързват Google Calendar без „unverified app“ екран.

4. **Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - **Authorized redirect URIs** (add **both** — Cloudflare may canonicalize `.html` to `/settings`):

```
https://ai-kasy.online/frontend/settings.html
https://ai-kasy.online/frontend/settings
https://aiva.radilov-k.workers.dev/settings.html
https://aiva.radilov-k.workers.dev/settings
```

Ако ползваш и GitHub Pages: `https://radilovk.github.io/aiva/frontend/settings.html`

5. Копирай **Client ID** и **Client secret**.

### 2. Cloudflare Worker secrets

От корена на репото:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
# По желание — фиксиран redirect (препоръчително за custom domain):
wrangler secret put GOOGLE_REDIRECT_URI
# https://ai-kasy.online/frontend/settings.html
```

В `wrangler.jsonc` провери `APP_URL` — трябва да съвпада с публичния URL на приложението.

### 3. Deploy

```bash
npm run deploy
```

### 4. Тест в приложението

1. Настройки → **Свържи Google**
2. Влез с акаунт от **Test users** (ако приложението е в Testing)
3. Избери календар от падащото меню → **Запази**

## Премахване на екрана „Непотвърдено приложение“

| Режим | Кой може да влезе | Екран „unverified“ |
| --- | --- | --- |
| **Testing** | Само добавени Test users | Показва се, но може да продължиш с „Advanced“ |
| **In production** (без verification) | Ограничено | Показва се за всички |
| **Verified** | Всички | Няма (след одобрение от Google) |

За публично PWA/APK трябва **OAuth verification** с обяснение защо ползваш Calendar scope, privacy policy URL (`/privacy.html`) и демо видео ако Google го поиска.

## По-малко повторни екрани за съгласие

Бекендът вече **не** изпраща `prompt=consent` при всяко свързване — Google показва consent само при първо свързване или при отнет достъп. Ако липсва `refresh_token`, разкачи и свържи отново Google от Настройки.

## Debug логове (само за разработка)

В браузъра:

```js
localStorage.setItem('aiva_debug', '1'); location.reload();
```

Или отвори `https://твоят-url/?debug=1`

## Свързани файлове

- `workers/src/calendar.ts` — OAuth поток
- `frontend/settings.html` — бутон „Свържи Google“
- `CALENDAR_SETUP.md` — архитектура (Google, Outlook, Apple)
