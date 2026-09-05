import { now } from '@/lib/temporal';
import { createLogger } from '@/lib/logger';
import { AgentRunRepository } from '@/repositories/agentRun.repository';
import { MessageRepository } from '@/repositories/message.repository';
import { CreditService } from '@/services/credit.service';
import type { ContentBlock } from './content';

export type TerminalRunStatus = 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type FinalizeArgs = {
  agentRunId: string;
  status: TerminalRunStatus;
  assistantMessageId?: string | null;
  /** Final assistant content blocks (optional if message already checkpointed). */
  content?: ContentBlock[];
  modelActual?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  turnCount?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type FinalizeResult = {
  agentRunId: string;
  status: TerminalRunStatus;
  alreadyTerminal: boolean;
};

const TERMINAL: ReadonlySet<string> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/**
 * Single terminal path for an agent run: status/tokens/modelActual, assistant
 * message finalization, credit reservation release, and chat lock clear.
 * Idempotent so retries and the sweeper converge on the same state.
 */
export async function finalizeAgentRun(args: FinalizeArgs): Promise<FinalizeResult> {
  const log = createLogger({ runId: args.agentRunId });
  const run = await AgentRunRepository.findById(args.agentRunId);
  if (!run) {
    log.warn('finalize skipped — agent run not found');
    return {
      agentRunId: args.agentRunId,
      status: args.status,
      alreadyTerminal: true,
    };
  }

  const tokensUsed = args.totalTokens ?? run.totalTokens ?? 0;
  const modelId = args.modelActual ?? run.modelActual ?? run.modelRequested;

  if (TERMINAL.has(run.status)) {
    // Still ensure credits released (convergent).
    await CreditService.finalizeRunBilling(
      run.userId,
      run.id,
      tokensUsed,
      modelId,
    );
    return {
      agentRunId: run.id,
      status: run.status as TerminalRunStatus,
      alreadyTerminal: true,
    };
  }

  const completedAt = now();

  await AgentRunRepository.updateState(run.id, {
    status: args.status,
    modelActual: args.modelActual ?? run.modelActual ?? undefined,
    promptTokens: args.promptTokens ?? run.promptTokens ?? undefined,
    completionTokens: args.completionTokens ?? run.completionTokens ?? undefined,
    totalTokens: args.totalTokens ?? run.totalTokens ?? undefined,
    turnCount: args.turnCount ?? run.turnCount ?? undefined,
    errorCode: args.errorCode ?? null,
    errorMessage: args.errorMessage ?? null,
    completedAt,
    heartbeatAt: completedAt,
  });

  const assistantMessageId = args.assistantMessageId ?? 
    (await MessageRepository.findLastAssistantMessageForRun(run.id))?.id ?? null;
    
  if (assistantMessageId) {
    const messageStatus =
      args.status === 'COMPLETED'
        ? 'COMPLETED'
        : args.status === 'CANCELLED'
          ? 'CANCELLED'
          : 'FAILED';

    await MessageRepository.updateMessageStatus(
      assistantMessageId, 
      messageStatus, 
      args.content
    );
  }

  await CreditService.finalizeRunBilling(
    run.userId,
    run.id,
    tokensUsed,
    modelId,
  );

  log.info('agent run finalized', { status: args.status });

  return {
    agentRunId: run.id,
    status: args.status,
    alreadyTerminal: false,
  };
}
