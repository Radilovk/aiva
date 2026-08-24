/**
 * Създава продуктите и цените на KASY в Stripe и записва price ID-тата в wrangler.jsonc.
 *
 *   node scripts/stripe-setup.mjs sk_test_...
 *
 * Безопасен за повторно пускане — вече създадените цени се преизползват по lookup_key,
 * така че скриптът никога не прави дубликати.
 *
 * Флагове:
 *   --with-pro   създава и еднократния план Pro Lifetime (по подразбиране е изключен;
 *                за старт се препоръчват само Free + Plus)
 *   --live       задължителен, когато ключът е sk_live_ — защита срещу случаен запис
 *                в реалния акаунт, докато още тестваш
 *   --dry-run    показва какво би направил, без да пише нищо
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_PATH = join(ROOT, 'wrangler.jsonc');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const KEY = args.find((a) => !a.startsWith('--')) || process.env.STRIPE_SECRET_KEY;

const WITH_PRO = flags.has('--with-pro');
const DRY_RUN = flags.has('--dry-run');

/** Плановете. `envVar` е ключът в wrangler.jsonc → vars. */
const PLANS = [
  {
    lookupKey: 'kasy_plus_monthly',
    envVar: 'STRIPE_PRICE_PLUS_MONTHLY',
    productKey: 'plus',
    productName: 'KASY Plus',
    productDescription: 'Гласови сесии, облачен календар, дневен AI бриф',
    label: 'KASY Plus — месечен',
    amount: 699,
    interval: 'month',
  },
  {
    lookupKey: 'kasy_plus_yearly',
    envVar: 'STRIPE_PRICE_PLUS_YEARLY',
    productKey: 'plus',
    productName: 'KASY Plus',
    productDescription: 'Гласови сесии, облачен календар, дневен AI бриф',
    label: 'KASY Plus — годишен (7 дни пробен период)',
    amount: 4999,
    interval: 'year',
  },
  {
    lookupKey: 'kasy_pro_lifetime',
    envVar: 'STRIPE_PRICE_PRO_LIFETIME',
    productKey: 'pro',
    productName: 'KASY Pro Lifetime',
    productDescription: 'Доживотен достъп до функциите на KASY Pro',
    label: 'KASY Pro Lifetime — еднократно',
    amount: 14900,
    interval: null,
    optional: true,
  },
];

function fail(message, hint) {
  console.error(`\n  ✗ ${message}`);
  if (hint) console.error(`    ${hint}`);
  console.error('');
  process.exit(1);
}

if (!KEY) {
  fail(
    'Липсва Stripe secret key.',
    'Подай го като аргумент:  node scripts/stripe-setup.mjs sk_test_...'
  );
}
if (!/^(sk|rk)_(test|live)_/.test(KEY)) {
  fail(
    'Това не прилича на Stripe secret key.',
    'Трябва да започва с sk_test_ или sk_live_ (Dashboard → Developers → API keys).'
  );
}

const IS_LIVE = KEY.includes('_live_');
if (IS_LIVE && !flags.has('--live')) {
  fail(
    'Подаде ЖИВ ключ (sk_live_), но без флага --live.',
    'Ако наистина искаш да пишеш в реалния акаунт, добави --live накрая.'
  );
}

async function stripe(path, { method = 'POST', body, query } = {}) {
  let url = `https://api.stripe.com/v1${path}`;
  if (query) url += `?${new URLSearchParams(query)}`;

  const init = {
    method,
    headers: { Authorization: `Bearer ${KEY}` },
  };
  if (body) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = params;
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    fail(
      `Няма връзка с api.stripe.com: ${err.message}`,
      'Провери интернет връзката или дали корпоративно прокси не блокира Stripe.'
    );
  }

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    fail(
      `Stripe върна неочакван отговор (HTTP ${res.status}).`,
      `Първите редове: ${raw.slice(0, 120).replace(/\s+/g, ' ')}`
    );
  }

  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 401) {
      fail(`Stripe отхвърли ключа: ${msg}`, 'Провери дали си копирал целия ключ.');
    }
    throw new Error(msg);
  }
  return data;
}

/** Намира съществуваща цена по lookup_key, за да не правим дубликати при повторно пускане. */
async function findPrice(lookupKey) {
  const res = await stripe('/prices', {
    method: 'GET',
    query: { 'lookup_keys[]': lookupKey, limit: '1', active: 'true' },
  });
  return res.data?.[0] || null;
}

/** Намира продукт по нашето metadata поле, иначе го създава. */
const productCache = new Map();
async function findOrCreateProduct(plan) {
  if (productCache.has(plan.productKey)) return productCache.get(plan.productKey);

  const existing = await stripe('/products', {
    method: 'GET',
    query: { limit: '100', active: 'true' },
  });
  let product = existing.data?.find((p) => p.metadata?.kasy_product === plan.productKey);

  if (!product) {
    if (DRY_RUN) {
      product = { id: `(нов продукт ${plan.productName})` };
    } else {
      product = await stripe('/products', {
        body: {
          name: plan.productName,
          description: plan.productDescription,
          'metadata[kasy_product]': plan.productKey,
        },
      });
    }
  }

  productCache.set(plan.productKey, product);
  return product;
}

/** Записва price ID-тата в wrangler.jsonc, без да пипа нищо друго (коментарите остават). */
function patchWrangler(priceIds) {
  const original = readFileSync(WRANGLER_PATH, 'utf8');
  let updated = original;
  const missing = [];

  for (const [envVar, priceId] of Object.entries(priceIds)) {
    const pattern = new RegExp(`("${envVar}"\\s*:\\s*)"[^"]*"`);
    if (!pattern.test(updated)) {
      missing.push(envVar);
      continue;
    }
    updated = updated.replace(pattern, `$1"${priceId}"`);
  }

  if (missing.length) {
    console.log(`\n  ⚠ Тези ключове ги няма в wrangler.jsonc — добави ги ръчно:`);
    for (const key of missing) console.log(`      "${key}": "${priceIds[key]}",`);
  }

  if (updated !== original && !DRY_RUN) {
    writeFileSync(WRANGLER_PATH, updated);
    return true;
  }
  return false;
}

async function main() {
  const mode = IS_LIVE ? 'LIVE (реални плащания)' : 'TEST (тестов режим)';
  console.log(`\n  Stripe режим: ${mode}`);
  if (DRY_RUN) console.log('  --dry-run: нищо няма да бъде записано.\n');
  else console.log('');

  const plans = PLANS.filter((p) => !p.optional || WITH_PRO);
  const priceIds = {};

  for (const plan of plans) {
    const existing = await findPrice(plan.lookupKey);

    if (existing) {
      priceIds[plan.envVar] = existing.id;
      console.log(`  · ${plan.label}\n      вече съществува → ${existing.id}`);
      continue;
    }

    const product = await findOrCreateProduct(plan);

    if (DRY_RUN) {
      priceIds[plan.envVar] = '(нова цена)';
      console.log(`  + ${plan.label}\n      би била създадена (${(plan.amount / 100).toFixed(2)} EUR)`);
      continue;
    }

    const body = {
      product: product.id,
      currency: 'eur',
      unit_amount: String(plan.amount),
      lookup_key: plan.lookupKey,
    };
    if (plan.interval) body['recurring[interval]'] = plan.interval;

    const price = await stripe('/prices', { body });
    priceIds[plan.envVar] = price.id;
    console.log(`  + ${plan.label}\n      създадена → ${price.id}`);
  }

  if (!WITH_PRO) {
    console.log('\n  · KASY Pro Lifetime — пропуснат (пусни с --with-pro, ако го искаш).');
  }

  const wrote = patchWrangler(priceIds);
  console.log(
    wrote
      ? '\n  ✓ Price ID-тата са записани в wrangler.jsonc.'
      : DRY_RUN
        ? '\n  (dry-run — wrangler.jsonc не е променен)'
        : '\n  · wrangler.jsonc вече беше актуален.'
  );

  console.log('\n  Следващи стъпки:\n');
  console.log('    1. cd workers && wrangler secret put STRIPE_SECRET_KEY');
  console.log('       (постави същия ключ, който подаде на този скрипт)\n');
  console.log('    2. Stripe Dashboard → Developers → Webhooks → Add endpoint');
  console.log('       URL:     https://aiva.radilov-k.workers.dev/api/stripe/webhook');
  console.log('       Events:  checkout.session.completed');
  console.log('                customer.subscription.updated');
  console.log('                customer.subscription.deleted\n');
  console.log('    3. wrangler secret put STRIPE_WEBHOOK_SECRET');
  console.log('       (Signing secret от стъпка 2 — започва с whsec_)\n');
  console.log('    4. Stripe Dashboard → Settings → Billing → Customer portal → Enable\n');
  console.log('    5. npm run deploy\n');
}

main().catch((e) => {
  fail(e.message || String(e));
});
