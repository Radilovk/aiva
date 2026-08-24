# Submit Google OAuth verification — action plan (radilov.k@gmail.com)

## Блокер, открит при запис на демо видеото

OAuth заявката изпращаше `redirect_uri=https://aiva.radilov-k.workers.dev/settings`, а в Google Console вероятно е регистриран само `.../settings.html` → **Error 400: redirect_uri_mismatch**.

### Стъпка 1 — ти (5 мин, без deploy)

Google Cloud Console → **APIs & Services** → **Credentials** → OAuth 2.0 Client ID  
→ **Authorized redirect URIs** → добави **и двете**:

```
https://aiva.radilov-k.workers.dev/settings.html
https://aiva.radilov-k.workers.dev/settings
```

Запази. Изчакай 1–2 мин.

### Стъпка 2 — merge PR и deploy

Merge branch `cursor/google-oauth-verification-video-8a6f` и deploy:

```bash
npm run deploy   # от root с wrangler 4 + CLOUDFLARE_API_TOKEN
```

(Фиксът в кода винаги изпраща `settings.html` като redirect_uri.)

### Стъпка 3 — запиши финалното видео (ти, ~5 мин)

Следвай **`docs/oauth-demo-video-script.md`**. Задължително на **английски**:

1. `https://aiva.radilov-k.workers.dev` — KASY branding
2. Settings → Connect Google
3. Consent screen на **English** + **client_id** в address bar
4. Allow → избери календар → Save
5. Покажи събития в календара (read)
6. Създай задача с час → виж събитие в Google Calendar (write)

Качи в YouTube като **Unlisted**.

> Черновата `google_oauth_verification_demo_draft.mp4` в artifacts показва грешката redirect_uri — **не я подавай на Google**.

### Стъпка 4 — Submit for verification

1. OAuth consent screen → **Publish app** (Production)
2. Verification Center → **Submit for verification**
3. Scope justification: копирай от `docs/OAUTH_SCOPE_JUSTIFICATION.txt`
4. Demo video: YouTube unlisted link
5. Privacy: `https://aiva.radilov-k.workers.dev/privacy.html`
6. Отговаряй на имейли на **radilov.k@gmail.com**

Пълен чеклист: `docs/GOOGLE_OAUTH_VERIFICATION.md`

### OAuth Client ID (от демо записа)

`556207268794-6u1n2qjss8asqeih605hsrmgrtm7j3rh.apps.googleusercontent.com`
