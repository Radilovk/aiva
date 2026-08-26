import { KVNamespace } from '@cloudflare/workers-types';

interface DailyCounter {
  date: string;
  count: number;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseDailyCounter(raw: string | null, today: string): number {
  if (!raw) return 0;

  try {
    const parsed = JSON.parse(raw) as Partial<DailyCounter>;
    if (typeof parsed.date === 'string' && typeof parsed.count === 'number') {
      return parsed.date === today ? parsed.count : 0;
    }
  } catch {
    const legacy = parseInt(raw, 10);
    return Number.isFinite(legacy) ? legacy : 0;
  }

  return 0;
}

/** Reads today's counter from a stable KV key (no date suffix, no TTL). */
export async function getDailyCount(kv: KVNamespace, key: string): Promise<number> {
  const today = todayUtc();
  const raw = await kv.get(key);
  if (raw !== null) return parseDailyCounter(raw, today);

  // Legacy keys used `key:YYYY-MM-DD` with a plain numeric value.
  return parseDailyCounter(await kv.get(`${key}:${today}`), today);
}

/**
 * Increments a per-day counter stored in one stable KV key.
 * The date is kept in the value, so keys are reused daily instead of expiring via TTL
 * (TTL expirations are billed as KV delete operations).
 */
export async function incrementDailyLimit(
  kv: KVNamespace,
  key: string,
  limit: number
): Promise<boolean> {
  const today = todayUtc();
  const raw = await kv.get(key);
  let current = parseDailyCounter(raw, today);

  if (current === 0 && raw === null) {
    current = parseDailyCounter(await kv.get(`${key}:${today}`), today);
  }

  if (current >= limit) return false;

  const next: DailyCounter = { date: today, count: current + 1 };
  await kv.put(key, JSON.stringify(next));
  return true;
}
