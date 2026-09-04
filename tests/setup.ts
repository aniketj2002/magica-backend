/**
 * Ensure required env vars exist before modules that parse env at import time.
 */
process.env.DATABASE_URL ??= 'postgresql://user:password@localhost:5432/mydb';
process.env.CLERK_SECRET_KEY ??= 'sk_test_vitest';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_vitest';
process.env.OPENROUTER_API_KEY ??= 'sk-or-vitest';
process.env.TRIGGER_SECRET_KEY ??= 'tr_dev_vitest';
process.env.TRIGGER_PROJECT_REF ??= 'proj_vitest';

/** MSW (and some Node runtimes) expect a Storage implementation. */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as Storage;
}
