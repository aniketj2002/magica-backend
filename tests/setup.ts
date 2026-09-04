/**
 * Ensure required env vars exist before modules that parse env at import time.
 */
process.env.DATABASE_URL ??= 'postgresql://user:password@localhost:5432/mydb';
process.env.CLERK_SECRET_KEY ??= 'sk_test_vitest';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??= 'pk_test_vitest';
process.env.OPENROUTER_API_KEY ??= 'sk-or-vitest';
process.env.TRIGGER_SECRET_KEY ??= 'tr_dev_vitest';
process.env.TRIGGER_PROJECT_REF ??= 'proj_vitest';
process.env.MAGICA_API_KEY ??= 'gx_vitest';
process.env.MAGICA_API_BASE_URL ??= 'https://inference.magica.com';
process.env.MAGICA_CREDIT_MARKUP ??= '1';
process.env.APP_PUBLIC_URL ??= 'http://localhost:3001';
process.env.TRANSLOADIT_AUTH_KEY ??= 'transloadit_key_vitest';
process.env.TRANSLOADIT_AUTH_SECRET ??= 'transloadit_secret_vitest';
process.env.TRANSLOADIT_R2_CREDENTIALS ??= 'magica_r2_vitest';
process.env.R2_ACCOUNT_ID ??= 'r2_account_vitest';
process.env.R2_BUCKET ??= 'magica-media-vitest';
process.env.R2_ACCESS_KEY_ID ??= 'r2_access_vitest';
process.env.R2_SECRET_ACCESS_KEY ??= 'r2_secret_vitest';
process.env.R2_PUBLIC_BASE_URL ??= 'https://media.test.local';

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
