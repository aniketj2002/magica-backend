import { auth, runs } from '@trigger.dev/sdk';
import { AppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { instantToIso } from '@/lib/cursor';
import { finalizeAgentRun } from '@/agent/finalize';
import { AgentRunRepository } from '@/repositories/agentRun.repository';
import { agentStream } from '@/trigger/streams';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export type AgentRunRealtime = {
  runId: string;
  streamId: string;
  publicAccessToken: string;
};

export const AgentRunService = {
  async getRun(runId: string, userId: string) {
    const run = await AgentRunRepository.findByIdForUser(runId, userId);
    if (!run) throw AppError.notFound();
    return await serializeRunWithRealtime(run);
  },

  /**
   * Cancel a run. Always finalizes CANCELLED in Postgres immediately —
   * Trigger `onCancel` does **not** run while a task is suspended on a
   * waitpoint token (Magica tools), so relying on it leaves STOPPING forever.
   * Still calls `runs.cancel` so Trigger abandons the suspended execution.
   */
  async cancelRun(runId: string, userId: string) {
    const run = await AgentRunRepository.findByIdForUser(runId, userId);
    if (!run) throw AppError.notFound();

    if (TERMINAL_STATUSES.has(run.status)) {
      return await serializeRunWithRealtime(run);
    }

    const log = createLogger({ runId: run.id, chatId: run.chatId });

    await finalizeAgentRun({
      agentRunId: run.id,
      status: 'CANCELLED',
      errorCode: 'cancelled',
      errorMessage: 'Run cancelled',
    });

    if (run.triggerRunId) {
      try {
        await runs.cancel(run.triggerRunId);
      } catch (error) {
        log.warn('trigger cancel failed after local finalize', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const refreshed = await AgentRunRepository.findById(run.id);
    return await serializeRunWithRealtime(refreshed ?? run);
  },
};

async function mintRealtimeToken(
  triggerRunId: string,
): Promise<AgentRunRealtime> {
  const publicAccessToken = await auth.createPublicToken({
    scopes: {
      read: {
        runs: [triggerRunId],
      },
    },
    expirationTime: '1h',
  });
  return {
    runId: triggerRunId,
    streamId: agentStream.id,
    publicAccessToken,
  };
}

async function serializeRunWithRealtime(run: {
  id: string;
  chatId: string;
  userId: string;
  messageId: string;
  status: string;
  modelRequested: string | null;
  modelActual: string | null;
  triggerTaskId: string | null;
  triggerRunId: string | null;
  turnCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  startedAt: unknown;
  completedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}) {
  const base = serializeRun(run);
  if (TERMINAL_STATUSES.has(run.status) || !run.triggerRunId) {
    return base;
  }
  const realtime = await mintRealtimeToken(run.triggerRunId);
  return { ...base, realtime };
}

function serializeRun(run: {
  id: string;
  chatId: string;
  userId: string;
  messageId: string;
  status: string;
  modelRequested: string | null;
  modelActual: string | null;
  triggerTaskId: string | null;
  triggerRunId: string | null;
  turnCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  startedAt: unknown;
  completedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}) {
  return {
    id: run.id,
    chatId: run.chatId,
    userId: run.userId,
    messageId: run.messageId,
    status: run.status,
    modelRequested: run.modelRequested,
    modelActual: run.modelActual,
    triggerTaskId: run.triggerTaskId,
    triggerRunId: run.triggerRunId,
    turnCount: run.turnCount,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    promptTokens: run.promptTokens,
    completionTokens: run.completionTokens,
    totalTokens: run.totalTokens,
    startedAt: run.startedAt ? instantToIso(run.startedAt) : null,
    completedAt: run.completedAt ? instantToIso(run.completedAt) : null,
    createdAt: instantToIso(run.createdAt),
    updatedAt: instantToIso(run.updatedAt),
  };
}
