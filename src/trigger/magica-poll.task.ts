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
 * Fallback only — Magica webhooks should complete the wait token first.
 * Poll Magica every ~35s for up to ~15m (matches wait token timeout).
 */
const POLL_INTERVAL_SECONDS = 35;
const POLL_MAX_ATTEMPTS = 26;

/**
 * Fallback poller for Magica node runs. Completes the waitpoint token when the
 * provider reaches a terminal status. Safe to race the Svix webhook — completing
 * an already-completed token is a no-op.
 */
export const magicaPollTask = schemaTask({
  id: MAGICA_POLL_TASK_ID,
  schema: MagicaPollPayloadSchema,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload): Promise<{ completed: boolean; status?: string }> => {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await wait.for({ seconds: POLL_INTERVAL_SECONDS });
      const run = await getNodeRun(payload.providerRunId);
      if (TERMINAL.has(run.status)) {
        await wait.completeToken(payload.waitpointTokenId, run);
        return { completed: true, status: run.status };
      }
    }

    const finalRun = await getNodeRun(payload.providerRunId);
    if (TERMINAL.has(finalRun.status)) {
      await wait.completeToken(payload.waitpointTokenId, finalRun);
      return { completed: true, status: finalRun.status };
    }

    return { completed: false, status: finalRun.status };
  },
});
