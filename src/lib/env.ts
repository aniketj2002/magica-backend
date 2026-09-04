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
});

export type Env = z.infer<typeof envSchema> & {
  /** Throws if OPENROUTER_API_KEY is unset. */
  requireOpenRouterApiKey(): string;
  /** Throws if TRIGGER_SECRET_KEY is unset. */
  requireTriggerSecretKey(): string;
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
  };
}

/** Zod-validated process.env. Parsed once on first access (fails fast). */
export const env: Env = buildEnv();
