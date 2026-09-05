import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  TRIGGER_SECRET_KEY: z.string().min(1).optional(),
  TRIGGER_PROJECT_REF: z.string().min(1).optional(),
  /** Comma-separated browser origins allowed for CORS (default: http://localhost:3000). */
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  MAGICA_API_KEY: z.string().min(1).optional(),
  MAGICA_API_BASE_URL: z
    .string()
    .min(1)
    .default('https://inference.magica.com'),
  MAGICA_WEBHOOK_SIGNING_SECRET: z.string().min(1).optional(),
  MAGICA_CREDIT_MARKUP: z.coerce.number().positive().default(1),
  /**
   * Local Magica VCR: `off` (default), `record` (live + write fixtures),
   * `mock` (replay fixtures, no Magica network).
   */
  MAGICA_VCR_MODE: z.enum(['off', 'record', 'mock']).default('off'),
  /** Directory for Magica VCR fixtures (default: fixtures/magica). */
  MAGICA_VCR_DIR: z.string().min(1).optional(),
  APP_PUBLIC_URL: z.string().url().optional(),
  TRANSLOADIT_AUTH_KEY: z.string().min(1).optional(),
  TRANSLOADIT_AUTH_SECRET: z.string().min(1).optional(),
  /** Template credential name registered in Transloadit for R2 (/cloudflare/store). */
  TRANSLOADIT_R2_CREDENTIALS: z.string().min(1).optional(),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** Public base URL for objects (no trailing slash), e.g. https://cdn.example.com */
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema> & {
  /** Throws if OPENROUTER_API_KEY is unset. */
  requireOpenRouterApiKey(): string;
  /** Throws if TRIGGER_SECRET_KEY is unset. */
  requireTriggerSecretKey(): string;
  /** Throws if MAGICA_API_KEY is unset. */
  requireMagicaApiKey(): string;
  /** Throws if APP_PUBLIC_URL is unset. */
  requireAppPublicUrl(): string;
  /** Throws if Transloadit auth is unset. */
  requireTransloaditAuth(): { key: string; secret: string; r2Credentials: string };
  /** Throws if R2 storage config is unset. */
  requireR2Config(): {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl: string;
  };
};

function buildEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }

  const data = parsed.data;

  return {
    ...data,
    requireOpenRouterApiKey() {
      if (!data.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY is not set');
      }
      return data.OPENROUTER_API_KEY;
    },
    requireTriggerSecretKey() {
      if (!data.TRIGGER_SECRET_KEY) {
        throw new Error('TRIGGER_SECRET_KEY is not set');
      }
      return data.TRIGGER_SECRET_KEY;
    },
    requireMagicaApiKey() {
      if (!data.MAGICA_API_KEY) {
        throw new Error('MAGICA_API_KEY is not set');
      }
      return data.MAGICA_API_KEY;
    },
    requireAppPublicUrl() {
      if (!data.APP_PUBLIC_URL) {
        throw new Error('APP_PUBLIC_URL is not set');
      }
      return data.APP_PUBLIC_URL.replace(/\/$/, '');
    },
    requireTransloaditAuth() {
      if (
        !data.TRANSLOADIT_AUTH_KEY ||
        !data.TRANSLOADIT_AUTH_SECRET ||
        !data.TRANSLOADIT_R2_CREDENTIALS
      ) {
        throw new Error(
          'TRANSLOADIT_AUTH_KEY, TRANSLOADIT_AUTH_SECRET, and TRANSLOADIT_R2_CREDENTIALS are required',
        );
      }
      return {
        key: data.TRANSLOADIT_AUTH_KEY,
        secret: data.TRANSLOADIT_AUTH_SECRET,
        r2Credentials: data.TRANSLOADIT_R2_CREDENTIALS,
      };
    },
    requireR2Config() {
      if (
        !data.R2_ACCOUNT_ID ||
        !data.R2_BUCKET ||
        !data.R2_ACCESS_KEY_ID ||
        !data.R2_SECRET_ACCESS_KEY ||
        !data.R2_PUBLIC_BASE_URL
      ) {
        throw new Error(
          'R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_PUBLIC_BASE_URL are required',
        );
      }
      const publicBaseUrl = data.R2_PUBLIC_BASE_URL.replace(/\/$/, '');
      if (publicBaseUrl.includes('r2.cloudflarestorage.com')) {
        throw new Error(
          'R2_PUBLIC_BASE_URL must be the public r2.dev or custom domain URL, not the private *.r2.cloudflarestorage.com API endpoint',
        );
      }
      return {
        accountId: data.R2_ACCOUNT_ID,
        bucket: data.R2_BUCKET,
        accessKeyId: data.R2_ACCESS_KEY_ID,
        secretAccessKey: data.R2_SECRET_ACCESS_KEY,
        publicBaseUrl,
      };
    },
  };
}

/** Zod-validated process.env. Parsed once on first access (fails fast). */
export const env: Env = buildEnv();
