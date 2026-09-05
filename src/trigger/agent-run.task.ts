import { metadata, schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import { db } from '@/prisma/db';
import { now } from '@/lib/temporal';
import { createLogger, useTriggerLogger } from '@/lib/logger';
import { ProviderError } from '@/providers/llm/errors';
import { finalizeAgentRun, runAgentLoop, type AgentStreamPart } from '@/agent';
import '@/tools/register';
import { agentRunQueue, AGENT_RUN_TASK_ID } from './queues';
import { agentStream } from './streams';

/**
 * Durable agent run. Payload is only the run id — everything else is read from
 * Postgres so retries are naturally idempotent.
 */
export const agentRunTask = schemaTask({
  id: AGENT_RUN_TASK_ID,
  schema: z.object({
    agentRunId: z.string().min(1),
  }),
  queue: agentRunQueue,
  retry: {
    maxAttempts: 2,
  },
  catchError: async ({ error }) => {
    if (ProviderError.isProviderError(error) && !error.retryable) {
      return { skipRetrying: true };
    }
    return undefined;
  },
  onFailure: async ({ payload, error }) => {
    useTriggerLogger(true);
    const message = error instanceof Error ? error.message : 'Agent run failed';
    const code = ProviderError.isProviderError(error) ? error.kind : 'task_failed';
    await finalizeAgentRun({
      agentRunId: payload.agentRunId,
      status: 'FAILED',
      errorCode: code,
      errorMessage: message,
    });
  },
  onCancel: async ({ payload }) => {
    useTriggerLogger(true);
    await finalizeAgentRun({
      agentRunId: payload.agentRunId,
      status: 'CANCELLED',
      errorCode: 'cancelled',
      errorMessage: 'Run cancelled',
    });
  },
  run: async ({ agentRunId }, { signal, ctx }) => {
    useTriggerLogger(true);
    const log = createLogger({ runId: agentRunId, traceId: ctx.run.id });

    const existing = await db.orm.public.AgentRun.where({ id: agentRunId }).first();
    if (!existing) {
      log.warn('agent run missing at task start');
      return { status: 'FAILED' as const, agentRunId };
    }
    // Cancel finalizes in Postgres while Magica waitpoints leave the Trigger
    // run suspended — if we resume after that, bail without rewriting state.
    if (
      existing.status === 'COMPLETED' ||
      existing.status === 'FAILED' ||
      existing.status === 'CANCELLED'
    ) {
      log.info('agent run already terminal; skipping', { status: existing.status });
      return { status: existing.status, agentRunId };
    }

    // Persist Trigger run id for Realtime tokens / cancellation.
    await db.orm.public.AgentRun.where({ id: agentRunId }).update({
      triggerRunId: ctx.run.id,
      triggerTaskId: AGENT_RUN_TASK_ID,
      updatedAt: now(),
    });

    metadata.set('status', 'RUNNING').set('agentRunId', agentRunId);

    const { readable, writable } = new TransformStream<AgentStreamPart, AgentStreamPart>();
    const writer = writable.getWriter();
    const { waitUntilComplete } = agentStream.pipe(readable);

    try {
      const result = await runAgentLoop({
        agentRunId,
        signal,
        logger: log,
        emit: async (part) => {
          if (part.type === 'status') {
            metadata.set('status', part.status);
          }
          if (part.type === 'turn') {
            metadata.set('turn', part.turn);
          }
          if (part.type === 'tool-call') {
            metadata.set('lastTool', part.name);
          }
          await writer.write(part);
        },
      });

      metadata.set('status', result.status);
      return result;
    } catch (error) {
      if (signal.aborted) {
        await finalizeAgentRun({
          agentRunId,
          status: 'CANCELLED',
          errorCode: 'cancelled',
          errorMessage: 'Run cancelled',
        });
        metadata.set('status', 'CANCELLED');
        return { status: 'CANCELLED' as const, agentRunId };
      }
      throw error;
    } finally {
      try {
        await writer.close();
      } catch {
        // already closed
      }
      await waitUntilComplete().catch(() => undefined);
    }
  },
});
