/**
 * Prints Google OAuth redirect URIs and Wrangler secret commands for KASY.
 *
 *   node scripts/google-oauth-setup.mjs
 *   APP_URL=https://kasy.example.com node scripts/google-oauth-setup.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  try {
    const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
    const m = wrangler.match(/"APP_URL"\s*:\s*"([^"]+)"/);
    if (m?.[1]) return m[1].replace(/\/$/, '');
  } catch {
    /* ignore */
  }
  return 'https://YOUR-WORKER.workers.dev';
}

const appUrl = readAppUrl();
const redirectUri = `${appUrl}/settings.html`;

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  KASY — Google OAuth checklist (създател)                    ║
╚══════════════════════════════════════════════════════════════╝

APP_URL: ${appUrl}

1) Google Cloud Console → APIs & Services
   • Enable: Google Calendar API
   • OAuth consent screen → External → add scope: calendar
   • Testing: add Test users OR submit for verification (production)

2) Credentials → OAuth client ID → Web application
   Authorized redirect URIs (exact match — add BOTH):

     ${redirectUri}
     ${appUrl}/settings

3) Cloudflare secrets:

     wrangler secret put GOOGLE_CLIENT_ID
     wrangler secret put GOOGLE_CLIENT_SECRET
     wrangler secret put GOOGLE_REDIRECT_URI   # optional: ${redirectUri}

4) Deploy:

     npm run deploy

5) In app: Settings → Свържи Google → pick calendar

Docs: GOOGLE_OAUTH_SETUP.md

Note: Chrome "Self-XSS" in DevTools is not from KASY.
      App debug logs: ?debug=1 or localStorage.aiva_debug=1
`);
