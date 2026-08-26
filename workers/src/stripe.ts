/**
 * Stripe Checkout + Customer Portal + webhook handlers.
 * Requires: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, price IDs in env vars.
 * @see docs/MONETIZATION.md
 */

import {
  getSubscription,
  setSubscription,
  tierFromStripePrice,
  type SubscriptionRecord,
} from './subscription';

export interface StripeEnv {
  SESSIONS: KVNamespace;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PLUS_MONTHLY?: string;
  STRIPE_PRICE_PLUS_YEARLY?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  STRIPE_PRICE_PRO_YEARLY?: string;
  STRIPE_PRICE_PRO_LIFETIME?: string;
  APP_URL?: string;
}

async function stripeRequest(env: StripeEnv, path: string, body: Record<string, unknown>) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe не е конфигуриран');

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }

  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const data = await res.json() as { error?: { message?: string }; url?: string; id?: string };
  if (!res.ok) throw new Error(data.error?.message || `Stripe error ${res.status}`);
  return data;
}

function appOrigin(env: StripeEnv, fallback: string): string {
  return (env.APP_URL || fallback).replace(/\/$/, '');
}

export async function createCheckoutSession(
  env: StripeEnv,
  userId: string,
  priceId: string,
  origin: string,
  planId?: string
): Promise<{ url: string }> {
  const successUrl = `${appOrigin(env, origin)}/settings.html?billing=success`;
  const cancelUrl = `${appOrigin(env, origin)}/settings.html?billing=cancel`;
  const isLifetime = priceId === env.STRIPE_PRICE_PRO_LIFETIME;

  const body: Record<string, unknown> = {
    mode: isLifetime ? 'payment' : 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    client_reference_id: userId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: 'true',
    billing_address_collection: 'auto',
  };

  if (!isLifetime && planId === 'plus_yearly') {
    body['subscription_data[trial_period_days]'] = 7;
  }

  const session = await stripeRequest(env, '/checkout/sessions', body);

  if (!session.url) throw new Error('Липсва Checkout URL');
  return { url: session.url };
}

export async function createPortalSession(
  env: StripeEnv,
  userId: string,
  origin: string
): Promise<{ url: string }> {
  const sub = await getSubscription(env.SESSIONS, userId);
  if (!sub.stripe_customer_id) throw new Error('Няма активен Stripe акаунт');

  const portal = await stripeRequest(env, '/billing_portal/sessions', {
    customer: sub.stripe_customer_id,
    return_url: `${appOrigin(env, origin)}/settings.html`,
  });

  if (!portal.url) throw new Error('Липсва Portal URL');
  return { url: portal.url };
}

/** Verify Stripe webhook signature (HMAC-SHA256). */
export async function verifyStripeWebhook(
  payload: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');

  return expected === v1;
}

export async function handleStripeWebhook(env: StripeEnv, payload: string, signature: string): Promise<void> {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Webhook secret не е конфигуриран');
  if (!await verifyStripeWebhook(payload, signature, secret)) {
    throw new Error('Невалиден webhook подпис');
  }

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: Record<string, unknown> };
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = String(session.client_reference_id || '');
      const customerId = String(session.customer || '');
      const subscriptionId = String(session.subscription || '');
      const mode = String(session.mode || '');

      if (!userId) return;

      let tier: SubscriptionRecord['tier'] = 'plus';
      if (mode === 'payment') {
        tier = 'pro';
      } else if (subscriptionId) {
        // Tier resolved on subscription.updated with price id
        tier = 'plus';
      }

      await setSubscription(env.SESSIONS, userId, {
        tier,
        status: 'active',
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId || undefined,
        updated_at: new Date().toISOString(),
      });
      if (customerId) await linkStripeCustomer(env.SESSIONS, customerId, userId);
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = String(subscription.customer || '');
      const status = String(subscription.status || 'canceled');
      const periodEnd = subscription.current_period_end
        ? new Date(Number(subscription.current_period_end) * 1000).toISOString()
        : undefined;
      const items = subscription.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
      const priceId = items?.data?.[0]?.price?.id || '';

      // Find user by scanning is expensive — store customer→user mapping on checkout
      const mapKey = `stripe:cust:${customerId}`;
      const userId = await env.SESSIONS.get(mapKey);
      if (!userId) return;

      const active = status === 'active' || status === 'trialing';
      await setSubscription(env.SESSIONS, userId, {
        tier: active ? tierFromStripePrice(priceId, env) : 'free',
        status: active ? (status as SubscriptionRecord['status']) : 'canceled',
        stripe_customer_id: customerId,
        stripe_subscription_id: String(subscription.id || ''),
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      });
      break;
    }

    default:
      break;
  }
}

/** Call after checkout.session.completed to map customer → user_id */
export async function linkStripeCustomer(
  kv: KVNamespace,
  customerId: string,
  userId: string
): Promise<void> {
  await kv.put(`stripe:cust:${customerId}`, userId);
}
