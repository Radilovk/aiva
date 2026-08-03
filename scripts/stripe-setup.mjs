/**
 * Creates KASY Stripe products/prices. Run once per Stripe account (test or live).
 *
 *   export STRIPE_SECRET_KEY=sk_test_...
 *   node scripts/stripe-setup.mjs
 */
const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('Set STRIPE_SECRET_KEY');
  process.exit(1);
}

async function stripe(path, body = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v != null) params.set(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || res.statusText);
  return data;
}

async function main() {
  const plusProduct = await stripe('/products', {
    name: 'KASY Plus',
    description: 'Voice sessions, cloud calendar, daily AI brief',
  });

  const plusMonthly = await stripe('/prices', {
    product: plusProduct.id,
    currency: 'eur',
    unit_amount: '699',
    'recurring[interval]': 'month',
  });

  const plusYearly = await stripe('/prices', {
    product: plusProduct.id,
    currency: 'eur',
    unit_amount: '4999',
    'recurring[interval]': 'year',
  });

  const proProduct = await stripe('/products', {
    name: 'KASY Pro Lifetime',
    description: 'Lifetime access to KASY Pro features',
  });

  const proLifetime = await stripe('/prices', {
    product: proProduct.id,
    currency: 'eur',
    unit_amount: '14900',
  });

  console.log('\nAdd to wrangler.jsonc vars:\n');
  console.log(`"STRIPE_PRICE_PLUS_MONTHLY": "${plusMonthly.id}",`);
  console.log(`"STRIPE_PRICE_PLUS_YEARLY": "${plusYearly.id}",`);
  console.log(`"STRIPE_PRICE_PRO_LIFETIME": "${proLifetime.id}",`);
  console.log('\nThen: wrangler secret put STRIPE_SECRET_KEY && npm run deploy\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
