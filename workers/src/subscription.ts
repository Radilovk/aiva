/**
 * Subscription tiers and limits — used by token rate limiting and Stripe webhooks.
 * Stripe integration: see docs/MONETIZATION.md
 */

export type SubscriptionTier = 'free' | 'plus' | 'pro';

export interface SubscriptionRecord {
  tier: SubscriptionTier;
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  current_period_end?: string;
  updated_at: string;
}

export interface TierLimits {
  sessions_per_day: number;
  max_active_tasks: number;
  cloud_calendar: boolean;
  daily_brief: boolean;
  google_grounding: boolean;
  voice_preview_per_day: number;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    sessions_per_day: 5,
    max_active_tasks: 50,
    cloud_calendar: false,
    daily_brief: false,
    google_grounding: false,
    voice_preview_per_day: 3,
  },
  plus: {
    sessions_per_day: 40,
    max_active_tasks: 10000,
    cloud_calendar: true,
    daily_brief: true,
    google_grounding: true,
    voice_preview_per_day: 100,
  },
  pro: {
    sessions_per_day: 100,
    max_active_tasks: 10000,
    cloud_calendar: true,
    daily_brief: true,
    google_grounding: true,
    voice_preview_per_day: 100,
  },
};

const SUB_KEY = (userId: string) => `sub:${userId}`;

export async function getSubscription(
  kv: KVNamespace,
  userId: string
): Promise<SubscriptionRecord> {
  const raw = await kv.get(SUB_KEY(userId));
  if (!raw) {
    return {
      tier: 'free',
      status: 'active',
      updated_at: new Date().toISOString(),
    };
  }
  try {
    const parsed = JSON.parse(raw) as SubscriptionRecord;
    if (parsed.status === 'active' || parsed.status === 'trialing') return parsed;
  } catch {
    /* ignore */
  }
  return {
    tier: 'free',
    status: 'canceled',
    updated_at: new Date().toISOString(),
  };
}

export async function setSubscription(kv: KVNamespace, userId: string, record: SubscriptionRecord): Promise<void> {
  await kv.put(SUB_KEY(userId), JSON.stringify(record), { expirationTtl: 400 * 86400 });
}

export function getTierLimits(tier: SubscriptionTier): TierLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

export function isStripeConfigured(env: { STRIPE_SECRET_KEY?: string }): boolean {
  return !!env.STRIPE_SECRET_KEY?.trim();
}

export function isLimitsEnforced(env: {
  STRIPE_SECRET_KEY?: string;
  SUBSCRIPTION_ENFORCED?: string;
}): boolean {
  return isStripeConfigured(env) && env.SUBSCRIPTION_ENFORCED === 'true';
}

export interface EffectiveSubscription {
  tier: SubscriptionTier;
  status: SubscriptionRecord['status'];
  limits: TierLimits;
  enforced: boolean;
  stripe_configured: boolean;
  current_period_end?: string;
}

export async function getEffectiveSubscription(
  env: {
    SESSIONS: KVNamespace;
    STRIPE_SECRET_KEY?: string;
    SUBSCRIPTION_ENFORCED?: string;
    MAX_SESSIONS_PER_DAY?: string;
  },
  userId: string,
  parseMaxSessions: (v: string | undefined, fallback: number) => number
): Promise<EffectiveSubscription> {
  const stripeConfigured = isStripeConfigured(env);
  const enforced = isLimitsEnforced(env);
  const sub = await getSubscription(env.SESSIONS, userId);

  if (!enforced) {
    const sessions = parseMaxSessions(env.MAX_SESSIONS_PER_DAY, 15);
    return {
      tier: sub.tier,
      status: sub.status,
      enforced: false,
      stripe_configured: stripeConfigured,
      current_period_end: sub.current_period_end,
      limits: {
        sessions_per_day: sessions,
        max_active_tasks: 10000,
        cloud_calendar: true,
        daily_brief: true,
        google_grounding: true,
        voice_preview_per_day: 100,
      },
    };
  }

  return {
    tier: sub.tier,
    status: sub.status,
    enforced: true,
    stripe_configured: stripeConfigured,
    current_period_end: sub.current_period_end,
    limits: getTierLimits(sub.tier),
  };
}

export function resolvePlanPriceId(
  plan: string,
  env: {
    STRIPE_PRICE_PLUS_MONTHLY?: string;
    STRIPE_PRICE_PLUS_YEARLY?: string;
    STRIPE_PRICE_PRO_LIFETIME?: string;
  }
): string | null {
  switch (plan) {
    case 'plus_monthly':
      return env.STRIPE_PRICE_PLUS_MONTHLY || null;
    case 'plus_yearly':
      return env.STRIPE_PRICE_PLUS_YEARLY || null;
    case 'pro_lifetime':
      return env.STRIPE_PRICE_PRO_LIFETIME || null;
    default:
      return null;
  }
}

export interface CatalogPlan {
  id: string;
  price_id: string | null;
  name: string;
  amount_cents: number;
  currency: string;
  interval: 'month' | 'year' | 'once';
  trial_days?: number;
  tier: SubscriptionTier;
}

export function getStripeCatalog(env: {
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_PLUS_MONTHLY?: string;
  STRIPE_PRICE_PLUS_YEARLY?: string;
  STRIPE_PRICE_PRO_LIFETIME?: string;
}): { configured: boolean; plans: CatalogPlan[] } {
  if (!isStripeConfigured(env)) {
    return { configured: false, plans: [] };
  }
  const plans: CatalogPlan[] = [];
  if (env.STRIPE_PRICE_PLUS_MONTHLY) {
    plans.push({
      id: 'plus_monthly',
      price_id: env.STRIPE_PRICE_PLUS_MONTHLY,
      name: 'KAYA Plus',
      amount_cents: 699,
      currency: 'eur',
      interval: 'month',
      tier: 'plus',
    });
  }
  if (env.STRIPE_PRICE_PLUS_YEARLY) {
    plans.push({
      id: 'plus_yearly',
      price_id: env.STRIPE_PRICE_PLUS_YEARLY,
      name: 'KAYA Plus',
      amount_cents: 4999,
      currency: 'eur',
      interval: 'year',
      trial_days: 7,
      tier: 'plus',
    });
  }
  if (env.STRIPE_PRICE_PRO_LIFETIME) {
    plans.push({
      id: 'pro_lifetime',
      price_id: env.STRIPE_PRICE_PRO_LIFETIME,
      name: 'KAYA Pro Lifetime',
      amount_cents: 14900,
      currency: 'eur',
      interval: 'once',
      tier: 'pro',
    });
  }
  return { configured: true, plans };
}

export function tierFromStripePrice(priceId: string, env: {
  STRIPE_PRICE_PLUS_MONTHLY?: string;
  STRIPE_PRICE_PLUS_YEARLY?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  STRIPE_PRICE_PRO_YEARLY?: string;
  STRIPE_PRICE_PRO_LIFETIME?: string;
}): SubscriptionTier {
  if (
    priceId === env.STRIPE_PRICE_PRO_MONTHLY ||
    priceId === env.STRIPE_PRICE_PRO_YEARLY ||
    priceId === env.STRIPE_PRICE_PRO_LIFETIME
  ) {
    return 'pro';
  }
  if (priceId === env.STRIPE_PRICE_PLUS_MONTHLY || priceId === env.STRIPE_PRICE_PLUS_YEARLY) {
    return 'plus';
  }
  return 'plus';
}
