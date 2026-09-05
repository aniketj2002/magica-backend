import { schemaTask, wait } from '@trigger.dev/sdk';
import { z } from 'zod';
import { getNodeRun } from '@/providers/magica';

export const MAGICA_POLL_TASK_ID = 'magica-poll' as const;

export const MagicaPollPayloadSchema = z.object({
  providerRunId: z.string().min(1),
  waitpointTokenId: z.string().min(1),
  toolInvocationId: z.string().min(1),
});

export type MagicaPollPayload = z.infer<typeof MagicaPollPayloadSchema>;

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELED']);

/**
 * Magica does not deliver reliable webhooks, so polling is the primary
 * completion path. Poll every 20s for up to ~15m (matches wait token timeout).
 */
const POLL_INTERVAL_SECONDS = 20;
const POLL_MAX_ATTEMPTS = 45;

/**
 * Poller for Magica node runs. Completes the waitpoint token when the provider
 * reaches a terminal status. Safe to race a webhook if one ever arrives —
 * completing an already-completed token is a no-op.
 */
export const magicaPollTask = schemaTask({
  id: MAGICA_POLL_TASK_ID,
  schema: MagicaPollPayloadSchema,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload): Promise<{ completed: boolean; status?: string }> => {
    // Check immediately — Magica may already be terminal by the time we start.
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await wait.for({ seconds: POLL_INTERVAL_SECONDS });
      }
      const run = await getNodeRun(payload.providerRunId);
      if (TERMINAL.has(run.status)) {
        await wait.completeToken(payload.waitpointTokenId, run);
        return { completed: true, status: run.status };
      }
    }

    return { completed: false };
  },
});
