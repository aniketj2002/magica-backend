import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GLOBAL_CAPACITY,
  USER_MAX_PER_MINUTE,
  UPLOAD_MAX_BYTES,
  consume,
  peek,
  rateLimitExceededError,
  rateLimitHeaders,
} from '@/lib/rate-limit';
import { jsonError } from '@/lib/http';
import { AppError } from '@/lib/errors';

type Hash = Record<string, string>;

const store = {
  strings: new Map<string, string>(),
  hashes: new Map<string, Hash>(),
};

function createMemoryRedis() {
  return {
    async incr(key: string) {
      const next = Number(store.strings.get(key) ?? '0') + 1;
      store.strings.set(key, String(next));
      return next;
    },
    async decr(key: string) {
      const next = Number(store.strings.get(key) ?? '0') - 1;
      store.strings.set(key, String(next));
      return next;
    },
    async get(key: string) {
      return store.strings.get(key) ?? null;
    },
    async expire(_key: string, _seconds: number) {
      return true;
    },
    async hGetAll(key: string) {
      return { ...(store.hashes.get(key) ?? {}) };
    },
    async hSet(key: string, value: Record<string, string>) {
      const prev = store.hashes.get(key) ?? {};
      store.hashes.set(key, { ...prev, ...value });
      return Object.keys(value).length;
    },
  };
}

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(async () => createMemoryRedis()),
  resetRedisClientForTests: vi.fn(),
}));

describe('rate-limit consume / peek', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  beforeEach(() => {
    store.strings.clear();
    store.hashes.clear();
  });

  it('allows two requests per user per minute then denies with rate_pace', async () => {
    const a = await consume('user-a', 'chat', now);
    const b = await consume('user-a', 'chat', now);
    const c = await consume('user-a', 'chat', now);

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
    if (!c.allowed) {
      expect(c.reason).toBe('rate_pace');
      expect(c.snapshot.perMinute.remaining).toBe(0);
      expect(c.snapshot.global.remaining).toBe(GLOBAL_CAPACITY - 2);
    }
  });

  it('does not burn pace slots when global quota is empty', async () => {
    store.hashes.set('rl:global:chat', {
      tokens: '0',
      updatedAt: String(now.getTime()),
    });

    const denied = await consume('user-a', 'chat', now);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.reason).toBe('rate_quota');
      expect(denied.snapshot.perMinute.remaining).toBe(USER_MAX_PER_MINUTE);
    }

    const peekSnap = await peek('user-a', 'chat', now);
    expect(peekSnap.perMinute.remaining).toBe(USER_MAX_PER_MINUTE);
  });

  it('denies the 11th successful consume across users with rate_quota', async () => {
    for (let i = 0; i < GLOBAL_CAPACITY; i++) {
      // Each user may only do 2/min; use distinct users for each token.
      const userId = `user-${Math.floor(i / USER_MAX_PER_MINUTE)}-${i}`;
      const result = await consume(userId, 'upload', now);
      expect(result.allowed).toBe(true);
    }

    const over = await consume('user-extra', 'upload', now);
    expect(over.allowed).toBe(false);
    if (!over.allowed) {
      expect(over.reason).toBe('rate_quota');
      expect(over.snapshot.global.remaining).toBe(0);
    }
  });

  it('refills global tokens over simulated time', async () => {
    store.hashes.set('rl:global:chat', {
      tokens: '0',
      updatedAt: String(now.getTime()),
    });

    const empty = await consume('user-a', 'chat', now);
    expect(empty.allowed).toBe(false);

    // GLOBAL_REFILL_PER_HOUR = 10 → 1 token every 6 minutes.
    const later = new Date(now.getTime() + 6 * 60 * 1000);
    const restored = await consume('user-a', 'chat', later);
    expect(restored.allowed).toBe(true);
    if (restored.allowed) {
      expect(restored.snapshot.global.remaining).toBe(0);
    }
  });

  it('keeps chat and upload buckets independent', async () => {
    await consume('user-a', 'chat', now);
    await consume('user-a', 'chat', now);
    const chatDenied = await consume('user-a', 'chat', now);
    const uploadOk = await consume('user-a', 'upload', now);

    expect(chatDenied.allowed).toBe(false);
    expect(uploadOk.allowed).toBe(true);
  });

  it('peek reports per-user pace and shared global remaining', async () => {
    await consume('user-a', 'chat', now);
    const snap = await peek('user-a', 'chat', now);
    expect(snap.perMinute).toMatchObject({
      limit: USER_MAX_PER_MINUTE,
      remaining: USER_MAX_PER_MINUTE - 1,
    });
    expect(snap.global).toMatchObject({
      limit: GLOBAL_CAPACITY,
      remaining: GLOBAL_CAPACITY - 1,
    });
  });
});

describe('429 path helpers', () => {
  it('builds rate_limit_exceeded AppError with both windows in details', () => {
    const result = {
      allowed: false as const,
      reason: 'rate_pace' as const,
      retryAfterSeconds: 42,
      snapshot: {
        perMinute: {
          limit: 2,
          remaining: 0,
          resetAt: '2026-09-08T12:01:00.000Z',
        },
        global: {
          limit: 10,
          remaining: 7,
          resetAt: '2026-09-08T13:00:00.000Z',
        },
      },
    };

    const err = rateLimitExceededError(result);
    expect(err).toMatchObject({
      code: 'rate_limit_exceeded',
      status: 429,
    } satisfies Partial<AppError>);
    expect(err.details).toMatchObject({
      reason: 'rate_pace',
      perMinute: result.snapshot.perMinute,
      global: result.snapshot.global,
    });

    const headers = rateLimitHeaders(result);
    expect(headers['Retry-After']).toBe('42');
    expect(headers['X-RateLimit-Limit']).toBe('2');
    expect(headers['X-RateLimit-Remaining']).toBe('0');

    const response = jsonError(err, { headers });
    expect(response.status).toBe(429);
  });

  it('uses global window headers when reason is rate_quota', () => {
    const headers = rateLimitHeaders({
      allowed: false,
      reason: 'rate_quota',
      retryAfterSeconds: 120,
      snapshot: {
        perMinute: {
          limit: 2,
          remaining: 2,
          resetAt: '2026-09-08T12:01:00.000Z',
        },
        global: {
          limit: 10,
          remaining: 0,
          resetAt: '2026-09-08T12:06:00.000Z',
        },
      },
    });
    expect(headers['X-RateLimit-Limit']).toBe('10');
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(headers['Retry-After']).toBe('120');
  });
});

describe('upload max bytes constant', () => {
  it('is 5 MiB', () => {
    expect(UPLOAD_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});
