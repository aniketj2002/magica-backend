import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { getRedis } from '@/lib/redis';

export const USER_MAX_PER_MINUTE = env.RATE_LIMIT_USER_MAX_PER_MINUTE;
export const GLOBAL_CAPACITY = env.RATE_LIMIT_GLOBAL_CAPACITY;
export const GLOBAL_REFILL_PER_HOUR = env.RATE_LIMIT_GLOBAL_REFILL_PER_HOUR;
export const UPLOAD_MAX_BYTES = env.UPLOAD_MAX_BYTES;

export type RateLimitBucket = 'chat' | 'upload';
export type RateLimitReason = 'rate_pace' | 'rate_quota';

export type RateLimitWindow = {
  limit: number;
  remaining: number;
  resetAt: string;
};

export type RateLimitSnapshot = {
  perMinute: RateLimitWindow;
  global: RateLimitWindow;
};

export type ConsumeResult =
  | { allowed: true; snapshot: RateLimitSnapshot }
  | {
      allowed: false;
      reason: RateLimitReason;
      snapshot: RateLimitSnapshot;
      retryAfterSeconds: number;
    };

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_TOKEN = MS_PER_HOUR / GLOBAL_REFILL_PER_HOUR;

function utcMinuteKey(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}`;
}

function endOfUtcMinute(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes() + 1,
      0,
      0,
    ),
  );
}

function userPaceKey(userId: string, bucket: RateLimitBucket, now: Date): string {
  return `rl:user:${userId}:${bucket}:pace:${utcMinuteKey(now)}`;
}

function globalKey(bucket: RateLimitBucket): string {
  return `rl:global:${bucket}`;
}

function refillTokens(tokens: number, updatedAtMs: number, nowMs: number): number {
  if (tokens >= GLOBAL_CAPACITY) return GLOBAL_CAPACITY;
  const elapsed = Math.max(0, nowMs - updatedAtMs);
  const gained = (elapsed / MS_PER_HOUR) * GLOBAL_REFILL_PER_HOUR;
  return Math.min(GLOBAL_CAPACITY, tokens + gained);
}

function globalResetAt(tokens: number, updatedAtMs: number, nowMs: number): Date {
  if (tokens >= GLOBAL_CAPACITY) {
    return new Date(nowMs);
  }
  if (tokens < 1) {
    const deficit = 1 - tokens;
    return new Date(updatedAtMs + deficit * MS_PER_TOKEN);
  }
  const toFull = GLOBAL_CAPACITY - tokens;
  return new Date(updatedAtMs + toFull * MS_PER_TOKEN);
}

function secondsUntil(resetAt: Date, nowMs: number): number {
  return Math.max(1, Math.ceil((resetAt.getTime() - nowMs) / 1000));
}

async function readGlobalState(bucket: RateLimitBucket, nowMs: number) {
  const redis = await getRedis();
  const raw = await redis.hGetAll(globalKey(bucket));
  const hasState = raw.tokens !== undefined && raw.tokens !== '';
  const storedTokens = hasState ? Number(raw.tokens) : GLOBAL_CAPACITY;
  const updatedAtMs = hasState && raw.updatedAt ? Number(raw.updatedAt) : nowMs;
  const tokens = refillTokens(
    Number.isFinite(storedTokens) ? storedTokens : GLOBAL_CAPACITY,
    Number.isFinite(updatedAtMs) ? updatedAtMs : nowMs,
    nowMs,
  );
  return { tokens, updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : nowMs };
}

async function writeGlobalState(
  bucket: RateLimitBucket,
  tokens: number,
  updatedAtMs: number,
): Promise<void> {
  const redis = await getRedis();
  await redis.hSet(globalKey(bucket), {
    tokens: String(tokens),
    updatedAt: String(updatedAtMs),
  });
}

async function paceUsed(userId: string, bucket: RateLimitBucket, now: Date): Promise<number> {
  const redis = await getRedis();
  const raw = await redis.get(userPaceKey(userId, bucket, now));
  const n = raw == null ? 0 : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function buildSnapshot(opts: {
  paceUsed: number;
  globalTokens: number;
  globalUpdatedAtMs: number;
  now: Date;
}): RateLimitSnapshot {
  const nowMs = opts.now.getTime();
  const perMinuteRemaining = Math.max(0, USER_MAX_PER_MINUTE - opts.paceUsed);
  const perMinuteReset = endOfUtcMinute(opts.now);
  const globalRemaining = Math.floor(opts.globalTokens);
  const globalReset = globalResetAt(
    opts.globalTokens,
    opts.globalUpdatedAtMs,
    nowMs,
  );

  return {
    perMinute: {
      limit: USER_MAX_PER_MINUTE,
      remaining: perMinuteRemaining,
      resetAt: perMinuteReset.toISOString(),
    },
    global: {
      limit: GLOBAL_CAPACITY,
      remaining: Math.max(0, globalRemaining),
      resetAt: globalReset.toISOString(),
    },
  };
}

function failClosed(err: unknown): never {
  throw new AppError(
    'rate_limit_unavailable',
    503,
    'Rate limit service unavailable',
    {
      cause: err instanceof Error ? err.message : String(err),
    },
  );
}

/**
 * Spend one request against user pace (2/min) then the global leaky bucket.
 * On quota deny, rolls back the pace counter so an empty global pool does not
 * burn the user's per-minute slots.
 */
export async function consume(
  userId: string,
  bucket: RateLimitBucket,
  now = new Date(),
): Promise<ConsumeResult> {
  try {
    const redis = await getRedis();
    const nowMs = now.getTime();
    const paceKey = userPaceKey(userId, bucket, now);

    const paceCount = await redis.incr(paceKey);
    if (paceCount === 1) {
      await redis.expire(paceKey, 60);
    }

    const global = await readGlobalState(bucket, nowMs);

    if (paceCount > USER_MAX_PER_MINUTE) {
      const snapshot = buildSnapshot({
        paceUsed: paceCount,
        globalTokens: global.tokens,
        globalUpdatedAtMs: global.updatedAtMs,
        now,
      });
      return {
        allowed: false,
        reason: 'rate_pace',
        snapshot,
        retryAfterSeconds: secondsUntil(
          new Date(snapshot.perMinute.resetAt),
          nowMs,
        ),
      };
    }

    if (global.tokens < 1) {
      await redis.decr(paceKey);
      const snapshot = buildSnapshot({
        paceUsed: Math.max(0, paceCount - 1),
        globalTokens: global.tokens,
        globalUpdatedAtMs: global.updatedAtMs,
        now,
      });
      return {
        allowed: false,
        reason: 'rate_quota',
        snapshot,
        retryAfterSeconds: secondsUntil(
          new Date(snapshot.global.resetAt),
          nowMs,
        ),
      };
    }

    const nextTokens = global.tokens - 1;
    await writeGlobalState(bucket, nextTokens, nowMs);

    return {
      allowed: true,
      snapshot: buildSnapshot({
        paceUsed: paceCount,
        globalTokens: nextTokens,
        globalUpdatedAtMs: nowMs,
        now,
      }),
    };
  } catch (err) {
    if (AppError.isAppError(err)) throw err;
    failClosed(err);
  }
}

/** Peek remaining user pace + global tokens without spending. */
export async function peek(
  userId: string,
  bucket: RateLimitBucket,
  now = new Date(),
): Promise<RateLimitSnapshot> {
  try {
    const nowMs = now.getTime();
    const used = await paceUsed(userId, bucket, now);
    const global = await readGlobalState(bucket, nowMs);
    return buildSnapshot({
      paceUsed: used,
      globalTokens: global.tokens,
      globalUpdatedAtMs: global.updatedAtMs,
      now,
    });
  } catch (err) {
    if (AppError.isAppError(err)) throw err;
    failClosed(err);
  }
}

/** Headers reflecting the constraint that failed (or remaining after allow). */
export function rateLimitHeaders(
  result: ConsumeResult | { allowed: true; snapshot: RateLimitSnapshot },
): Record<string, string> {
  const snapshot = result.snapshot;
  const reason = 'reason' in result && !result.allowed ? result.reason : null;
  const window =
    reason === 'rate_quota' ? snapshot.global : snapshot.perMinute;

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(window.limit),
    'X-RateLimit-Remaining': String(window.remaining),
    'X-RateLimit-Reset': String(
      Math.floor(new Date(window.resetAt).getTime() / 1000),
    ),
    'X-RateLimit-Policy': `user;q=${USER_MAX_PER_MINUTE};w=60, global;q=${GLOBAL_CAPACITY};w=3600`,
  };

  if (!result.allowed && 'retryAfterSeconds' in result) {
    headers['Retry-After'] = String(result.retryAfterSeconds);
  }

  return headers;
}

export function rateLimitExceededError(result: Extract<ConsumeResult, { allowed: false }>) {
  const message =
    result.reason === 'rate_pace'
      ? 'Too many requests; try again shortly'
      : 'Shared rate quota exhausted; try again later';

  return AppError.tooManyRequests(message, {
    reason: result.reason,
    perMinute: result.snapshot.perMinute,
    global: result.snapshot.global,
  });
}
