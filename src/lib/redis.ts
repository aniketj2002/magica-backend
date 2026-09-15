import { createClient, type RedisClientType } from 'redis';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

/** Shared Redis client (node-redis). Lazily connects on first use. */
export async function getRedis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;

  if (!connecting) {
    connecting = (async () => {
      const next = createClient({ url: env.REDIS_URL });
      next.on('error', (err) => {
        log.error('Redis client error', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
      await next.connect();
      client = next as RedisClientType;
      return client;
    })().finally(() => {
      connecting = null;
    });
  }

  return connecting;
}

/** Test helper: drop the cached client (e.g. after mocks). */
export function resetRedisClientForTests(): void {
  client = null;
  connecting = null;
}
