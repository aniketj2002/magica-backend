import { defineConfig } from '@trigger.dev/sdk';

/**
 * Trigger.dev project config.
 * Set TRIGGER_PROJECT_REF (e.g. proj_...) from the Trigger.dev dashboard.
 * Local runs need `npx trigger.dev@latest dev` alongside `next dev`.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? 'proj_magica_local',
  dirs: ['./src/trigger'],
  maxDuration: 600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    // Prisma Next imports contract.json with `{ type: 'json' }`; keep the
    // driver external so esbuild does not mangle the native/runtime bits.
    external: ['@prisma/orm-postgres', '@prisma/orm-family-sql'],
  },
});
