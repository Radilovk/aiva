# KASY — OAuth demo video script (English)

**Target length:** 3–5 minutes  
**Resolution:** 1920×1080 or 1280×720  
**Language:** English (consent screen + narration)

## Scene 1 — App identity (15 s)

- Open: `https://aiva.radilov-k.workers.dev`
- Show KASY logo and main calendar/task UI
- **Narration:** "This is KASY, an AI voice secretary for tasks and Google Calendar."

## Scene 2 — Privacy & optional connection (10 s)

- Open `https://aiva.radilov-k.workers.dev/privacy.html` (brief scroll to Google section)
- **Narration:** "Calendar access is optional. Our privacy policy explains how Google data is used."

## Scene 3 — Start OAuth (20 s)

- Go to **Settings** (`settings.html`)
- Scroll to **Calendar sync**
- Click **Connect Google**
- **Narration:** "The user initiates connection from Settings. No background access."

## Scene 4 — Consent screen (30 s) — REQUIRED

- Google account sign-in if needed
- On consent screen: switch language to **English** (bottom-left)
- **Zoom or highlight address bar** — must show `client_id=`
- Show app name **KASY** and scope **See, edit, share, and permanently delete all the calendars that you can access using Google Calendar** (or equivalent for `calendar` scope)
- Click **Allow**
- **Narration:** "The OAuth consent screen shows the app name, requested calendar scope, and client ID in the URL."

## Scene 5 — Select calendar (15 s)

- Back in KASY Settings: calendar dropdown loads
- Select a calendar → **Save**
- Status shows connected
- **Narration:** "The user chooses which calendar to sync."

## Scene 6 — Read scope usage (30 s)

- Open main app calendar **day view**
- Show events loaded from Google (or week view)
- **Narration:** "KASY reads events from the selected Google calendar to display schedule and inform the voice assistant."

## Scene 7 — Write scope usage (45 s)

- Create a new task with title, date, and time (UI or voice)
- Open Google Calendar in another tab — show new event
- **Narration:** "When the user creates a task with a due time, KASY writes an event to Google Calendar."

## Scene 8 — Update / delete (30 s, recommended)

- Edit task time or delete task in KASY
- Show corresponding change in Google Calendar
- **Narration:** "Edits and deletions sync back to Google Calendar."

## Scene 9 — Disconnect (15 s)

- Settings → **Disconnect** Google
- **Narration:** "Users can revoke access anytime from Settings."

## Upload

1. YouTube Studio → Upload
2. Title: `KASY Google Calendar OAuth Demo`
3. Visibility: **Unlisted**
4. Paste link in Google Cloud Verification Center
