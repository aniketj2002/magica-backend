import { schedules, tasks } from '@trigger.dev/sdk';
import { Temporal } from '@js-temporal/polyfill';
import { db } from '@/prisma/db';
import { now } from '@/lib/temporal';
import { createLogger, useTriggerLogger } from '@/lib/logger';
import { finalizeAgentRun } from '@/agent';
import type { agentRunTask } from './agent-run.task';
import { AGENT_RUN_TASK_ID, agentRunTriggerOptions } from './queues';

/** Runs stuck RUNNING with heartbeat older than this are failed. */
export const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

/** QUEUED runs with no triggerRunId older than this are re-dispatched. */
export const QUEUED_ORPHAN_MS = 60 * 1000;

const BATCH_LIMIT = 50;

/**
 * Sweeper closing the two durability gaps:
 * 1. QUEUED with no triggerRunId (died between commit and dispatch) → re-dispatch
 * 2. RUNNING past heartbeat threshold → fail + clear chat lock
 */
export const reconcileAgentRunsTask = schedules.task({
  id: 'reconcile-agent-runs',
  // Every minute
  cron: '* * * * *',
  run: async () => {
    useTriggerLogger(true);
    const log = createLogger({ traceId: 'reconcile-agent-runs' });
    const instant = now();

    const orphanCutoff = instant.subtract(
      Temporal.Duration.from({ milliseconds: QUEUED_ORPHAN_MS }),
    );
    const staleCutoff = instant.subtract(
      Temporal.Duration.from({ milliseconds: HEARTBEAT_STALE_MS }),
    );

    const redispatched = await redispatchOrphans(orphanCutoff, log);
    const failed = await failStaleRuns(staleCutoff, log);

    log.info('reconcile complete', { redispatched, failed });
    return { redispatched, failed };
  },
});

async function redispatchOrphans(
  cutoff: Temporal.Instant,
  log: ReturnType<typeof createLogger>,
): Promise<number> {
  const orphans = await db.orm.public.AgentRun.where({ status: 'QUEUED' })
    .where((r) => r.triggerRunId.isNull())
    .where((r) => r.createdAt.lt(cutoff))
    .orderBy((r) => r.createdAt.asc())
    .limit(BATCH_LIMIT)
    .all();

  let count = 0;
  for (const run of orphans) {
    try {
      const handle = await tasks.trigger<typeof agentRunTask>(
        AGENT_RUN_TASK_ID,
        { agentRunId: run.id },
        agentRunTriggerOptions(run.chatId, run.id),
      );

      await db.orm.public.AgentRun.where({ id: run.id }).update({
        triggerRunId: handle.id,
        triggerTaskId: AGENT_RUN_TASK_ID,
        updatedAt: now(),
      });
      count += 1;
      log.info('re-dispatched orphaned agent run', {
        runId: run.id,
        chatId: run.chatId,
        triggerRunId: handle.id,
      });
    } catch (error) {
      log.error('failed to re-dispatch orphaned agent run', {
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return count;
}

async function failStaleRuns(
  cutoff: Temporal.Instant,
  log: ReturnType<typeof createLogger>,
): Promise<number> {
  const stale = await db.orm.public.AgentRun.where({ status: 'RUNNING' })
    .where((r) => r.heartbeatAt.isNotNull())
    .where((r) => r.heartbeatAt.lt(cutoff))
    .orderBy((r) => r.heartbeatAt.asc())
    .limit(BATCH_LIMIT)
    .all();

  // Also catch RUNNING with a null heartbeat that started long ago.
  const noHeartbeat = await db.orm.public.AgentRun.where({ status: 'RUNNING' })
    .where((r) => r.heartbeatAt.isNull())
    .where((r) => r.startedAt.isNotNull())
    .where((r) => r.startedAt.lt(cutoff))
    .orderBy((r) => r.startedAt.asc())
    .limit(BATCH_LIMIT)
    .all();

  const byId = new Map<string, (typeof stale)[number]>();
  for (const run of [...stale, ...noHeartbeat]) {
    byId.set(run.id, run);
  }

  let count = 0;
  for (const run of byId.values()) {
    try {
      await finalizeAgentRun({
        agentRunId: run.id,
        status: 'FAILED',
        errorCode: 'stale_heartbeat',
        errorMessage: 'Agent run heartbeat expired',
      });
      count += 1;
      log.warn('failed stale agent run', { runId: run.id, chatId: run.chatId });
    } catch (error) {
      log.error('failed to finalize stale agent run', {
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return count;
}
