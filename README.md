# AIVA — Гласов мениджър на задачи (Bulgarian Voice Task Manager)

AI-powered voice task manager that listens in Bulgarian, detects emotion from voice tone, and saves tasks intelligently.

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐     WebSocket      ┌─────────────────┐
│   Frontend  │ ◄─────────────────► │ Cloudflare Worker │ ◄─────────────────► │ Gemini Live API │
│  (Vanilla JS)│                    │   (Hono router)   │                    │                 │
└─────────────┘                    └──────────────────┘                    └─────────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │ Cloudflare D1│
                                    │  (SQLite)    │
                                    └─────────────┘
```

## Features

- 🎙️ Voice input in Bulgarian via microphone
- 🧠 Emotion detection from voice tone (stress, tired, urgent, neutral)
- 🤖 Adaptive AI responses (calm when stressed, brief when tired)
- 📋 Automatic task extraction and saving
- ⏰ Evening priority review (cron at 19:00)
- 🔒 API key never exposed to frontend

## Tech Stack

- **AI**: Gemini Live API (`gemini-3.1-flash-live-preview`, per [Google's ephemeral-token example](https://github.com/google-gemini/gemini-live-api-examples/tree/main/gemini-live-ephemeral-tokens-websocket))
- **Backend**: Cloudflare Workers + Hono
- **Database**: Cloudflare D1
- **Frontend**: Vanilla JS with Web Audio API

## Setup

### 1. Install dependencies

```bash
cd workers
npm install
```

### 2. Create D1 database

```bash
wrangler d1 create aiva-db
```

Update `wrangler.toml` with the generated database ID.

### 3. Run migrations

```bash
cd workers
npm run db:migrate
```

### 4. Set secrets

```bash
wrangler secret put GEMINI_API_KEY
```

### 5. Create KV namespace

```bash
wrangler kv namespace create SESSIONS
```

Update `wrangler.toml` with the generated KV namespace ID.

### 6. Deploy

```bash
cd workers
npm run deploy
```

### 7. Frontend (single source of truth)

All UI lives in **`frontend/`** only (served as Worker static assets via `wrangler.jsonc`).  
Do not use duplicate HTML/JS at the repo root — they were removed to avoid drift.

- Production: `https://aiva.radilov-k.workers.dev`
- GitHub Pages (`*.github.io`) uses the same UI but calls the Worker API for `/api/*` (see `frontend/config.js`).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks/:user_id` | Get incomplete tasks |
| PATCH | `/api/tasks/:id/done` | Mark task complete |
| POST | `/api/users/register` | Register push token |
| POST | `/api/token` | Get ephemeral Gemini token |

## Audio Format

- **Input**: Raw 16-bit PCM, 16kHz, mono, little-endian
- **Output**: Raw 16-bit PCM, 24kHz, mono

## Cron Job

Every day at 19:00 UTC, the worker fetches all incomplete tasks and asks Gemini to prioritize the top 3 for tomorrow.