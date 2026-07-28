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
