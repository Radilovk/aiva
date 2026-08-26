#!/usr/bin/env node
/**
 * Set Cloudflare Worker secrets from Google OAuth client JSON download.
 *
 *   node scripts/set-google-oauth-from-json.mjs path/to/client_secret_....json
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonPath = process.argv[2];

if (!jsonPath) {
  console.error('Usage: node scripts/set-google-oauth-from-json.mjs <client_secret.json>');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
const web = raw.web || raw.installed;
if (!web?.client_id || !web?.client_secret) {
  console.error('Invalid JSON: expected web.client_id and web.client_secret');
  process.exit(1);
}

const clientId = String(web.client_id).trim();
const clientSecret = String(web.client_secret).trim();

console.log('Client ID suffix:', clientId.slice(-24));
console.log('Secret length:', clientSecret.length, '(expected 35 for GOCSPX-...)');

function putSecret(name, value) {
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    cwd: root,
    input: value,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`Failed to set ${name}:`, r.stderr || r.stdout);
    process.exit(1);
  }
  console.log(`✓ ${name} set`);
}

putSecret('GOOGLE_CLIENT_ID', clientId);
putSecret('GOOGLE_CLIENT_SECRET', clientSecret);

const redirect = web.redirect_uris?.[0] || 'https://ai-kasy.online/frontend/settings.html';
putSecret('GOOGLE_REDIRECT_URI', redirect.trim());

console.log('\nDeploy: npx wrangler deploy');
console.log('Verify: curl https://aiva.radilov-k.workers.dev/api/calendar/google-credential-check');
