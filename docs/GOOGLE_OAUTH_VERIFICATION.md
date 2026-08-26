# Google OAuth Verification — KASY (Production)

**App URL:** https://ai-kasy.online/frontend/  
**Privacy policy:** https://ai-kasy.online/frontend/privacy.html  
**Support / developer email:** radilov.k@gmail.com  
**Redirect URIs (register both in Google Cloud Console):**
- `https://ai-kasy.online/frontend/settings.html`
- `https://ai-kasy.online/frontend/settings`
- `https://aiva.radilov-k.workers.dev/settings.html` (legacy Worker URL)
- `https://aiva.radilov-k.workers.dev/settings`

Use this document when submitting **Submit for verification** in Google Cloud Console → **OAuth consent screen** → **Verification Center**.

---

## 1. Scopes to declare

| Scope | Classification | Why KASY needs it |
|-------|----------------|-------------------|
| `openid` | Non-sensitive | Identify the Google account during OAuth |
| `email` | Sensitive | Show which Google account is connected in Settings |
| `profile` | Sensitive | Display account name in Settings |
| `https://www.googleapis.com/auth/calendar.events` | Sensitive | View and edit events on all calendars (see justification below) |

> **Important:** The privacy policy, consent screen, and verification form must list the **same** scopes. KASY requests only `calendar.events` (not the full `calendar` scope).

---

## 2. Scope justification (copy-paste for Google form)

### `https://www.googleapis.com/auth/calendar.events`

KASY is a voice-first personal assistant for tasks and calendar management (web PWA and Android APK). Calendar access is **optional** and only used after the user taps **Connect Google** in Settings.

We use this scope to:

1. **Read events** — show upcoming events in the in-app calendar and give the voice assistant context (`read_calendar_events` tool).
2. **Create events** — when the user creates a task with a date/time, KASY creates a matching Google Calendar event.
3. **Update / delete events** — when the user edits or removes a synced task or calendar event via UI or voice (`edit_calendar_event`, `delete_calendar_event`).

Data is used only to provide these features. We do **not** use Google Calendar data for ads, profiling, or resale. Users can disconnect Google at any time from Settings → Disconnect.

The full `calendar` scope is **not** required — we only need to view and edit events on calendars the user already has access to.

### `email` / `profile` / `openid`

Used only to identify and display the connected Google account in Settings. No other Google user data is accessed through these scopes.

---

## 3. Pre-submission checklist

### Google Cloud Console

- [ ] **Google Calendar API** enabled
- [ ] OAuth consent screen: **External**, app name **KASY**, support email **radilov.k@gmail.com**
- [ ] **App domain:** `aiva.radilov-k.workers.dev`
- [ ] **Privacy policy link:** `https://aiva.radilov-k.workers.dev/privacy.html`
- [ ] **Authorized domains:** `radilov-k.workers.dev` (and custom domain if any)
- [ ] **Scopes** added: `calendar`, `email`, `profile`, `openid`
- [ ] **OAuth client (Web):** redirect URI exactly `https://aiva.radilov-k.workers.dev/settings.html`
- [ ] **Publishing status:** move from Testing → **In production** (required before public verification)
- [ ] **Branding:** logo uploaded, app name matches video

### Cloudflare (already configured if `/api/calendar/providers/status` shows `google.configured: true`)

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REDIRECT_URI   # https://aiva.radilov-k.workers.dev/settings.html
npm run deploy
```

### Demo video (YouTube, **Unlisted**)

Record in **English** (toggle language on consent screen bottom-left). Video must show:

1. App home at `https://aiva.radilov-k.workers.dev` — **KASY** branding visible
2. **Settings** → Calendar section → **Connect Google**
3. Full **OAuth consent screen** — app name, all scopes, **English**
4. **Browser address bar** showing OAuth `client_id=...` parameter
5. After grant: select calendar → Save
6. **Scope usage:**
   - Calendar view shows Google events (read)
   - Create task with date/time → event appears in Google Calendar (write)
   - Edit or delete event from app (update/delete) — optional but recommended

Upload to YouTube Studio → Visibility: **Unlisted** → paste link in Verification Center.

**Local artifact:** `docs/oauth-demo-video-script.md` (narration script)  
**Recorded demo:** see project artifacts / `google_oauth_verification_demo.mp4`

---

## 4. Demo video narration script (English)

Read while recording (or add as subtitles):

> "This is KASY, a voice assistant for tasks and calendar at aiva.radilov-k.workers.dev.  
> I open Settings, scroll to Calendar sync, and tap Connect Google.  
> Google shows the OAuth consent screen in English with the calendar scope.  
> The client ID is visible in the browser address bar.  
> After I allow access, I choose my Google calendar and save.  
> KASY reads my calendar events and displays them in the day view.  
> I create a task with a date and time — KASY syncs it to Google Calendar.  
> I can edit or delete the event from KASY; changes sync to Google.  
> Users can disconnect Google anytime from Settings."

---

## 5. Submit for verification

1. Google Cloud Console → **APIs & Services** → **OAuth consent screen**
2. **Publish app** (leave Testing) → confirm production
3. **Verification Center** → **Submit for verification**
4. Paste scope justifications (section 2)
5. Paste **YouTube unlisted** demo link
6. Reply promptly to Google emails at **radilov.k@gmail.com**

Typical review: several business days to a few weeks. Google may request:
- More detail on data handling
- Updated video if consent screen language/scopes don't match
- **CASA security assessment** — only if you request **restricted** scopes (KASY uses sensitive `calendar`, not restricted Gmail/Drive scopes)

---

## 6. After approval

- Remove test-user-only restriction — any Google user can connect
- "Unverified app" warning disappears for approved scopes
- Monitor **OAuth consent screen** → **Metrics** for errors

---

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| redirect_uri_mismatch | Redirect URI must match exactly, including `https` and `/settings.html` |
| Access blocked: app not verified | Complete verification or add user as Test user while in Testing |
| No refresh token | Disconnect and reconnect Google once from Settings |
| Video rejected — no consent screen | Re-record with English consent + client_id in URL bar |
| Scope mismatch in video vs form | Update form or re-record; must match exactly |
