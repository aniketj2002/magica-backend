import { AgentRunRepository } from '@/repositories/agentRun.repository';
import { MessageRepository } from '@/repositories/message.repository';
import { now } from '@/lib/temporal';
import { createLogger, type Logger } from '@/lib/logger';
import { InsufficientCreditsError } from '@/lib/credits-errors';
import { resolveProvider } from '@/providers/llm/registry';
import { ProviderError } from '@/providers/llm/errors';
import type {
  ChatProvider,
  FinishReason,
  ProviderEvent,
  ProviderMessage,
  ProviderToolCall,
} from '@/providers/llm/types';
import { toProviderTools, executeTool } from '@/tools';
import { CreditReservationService } from '@/services/creditReservation.service';
import { estimateModelCredits } from '@/services/modelCredits.policy';
import {
  appendToolResult,
  appendToolUse,
  assistantBlocksToProviderMessages,
  mergeTextDelta,
  mergeThinkingDelta,
  parseContentBlocks,
  upsertUsage,
  type ContentBlock,
} from './content';
import { restoreContext } from './context';
import { buildSystemPrompt } from './prompts';
import { finalizeAgentRun, type TerminalRunStatus } from './finalize';

export const DEFAULT_MAX_TURNS = 8;

export type AgentStreamPart =
  | { type: 'status'; status: string }
  | { type: 'turn'; turn: number }
  | { type: 'model-resolved'; model: string }
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; argumentsJson: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; output?: unknown }
  | { type: 'tool-progress'; id: string; name: string; status: string }
  | {
      type: 'tool-approval-required';
      id: string;
      name: string;
      credits: number;
    }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }
  | { type: 'finish'; reason: FinishReason }
  | { type: 'error'; code: string; message: string };

export type RunAgentLoopArgs = {
  agentRunId: string;
  signal: AbortSignal;
  maxTurns?: number;
  /** Emit normalized stream parts (piped to Trigger Realtime by the task). */
  emit?: (part: AgentStreamPart) => void | Promise<void>;
  logger?: Logger;
};

export type RunAgentLoopResult = {
  status: TerminalRunStatus;
  assistantMessageId: string;
  turnCount: number;
  modelActual: string | null;
};

type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** Why a run ended badly — the only thing `settle` needs beyond the status. */
type Failure = { code: string; message: string };

const CANCELLED: Failure = { code: 'cancelled', message: 'Run cancelled' };

/** Everything one run needs. `state` is the only mutable part. */
type LoopContext = {
  args: RunAgentLoopArgs;
  log: Logger;
  provider: ChatProvider;
  modelId: string;
  run: { id: string; chatId: string; userId: string };
  assistantMessageId: string;
  state: {
    blocks: ContentBlock[];
    turnCount: number;
    modelActual: string | null;
    usage: TokenUsage;
  };
};

/** What a single provider turn asks the loop to do next. */
type TurnOutcome =
  | { kind: 'cancelled' }
  | { kind: 'tool_calls'; calls: ProviderToolCall[] }
  | { kind: 'finished'; reason: FinishReason | null };

/**
 * Provider-agnostic turn loop: stream → accumulate blocks → emit → checkpoint →
 * optionally execute tools → continue until stop / maxTurns / cancel / fatal error.
 */
export async function runAgentLoop(args: RunAgentLoopArgs): Promise<RunAgentLoopResult> {
  const maxTurns = args.maxTurns ?? DEFAULT_MAX_TURNS;
  const ctx = await openLoop(args);

  try {
    while (ctx.state.turnCount < maxTurns) {
      if (args.signal.aborted) return await settle(ctx, 'CANCELLED', CANCELLED);

      ctx.state.turnCount += 1;
      await emit(args, { type: 'turn', turn: ctx.state.turnCount });
      await heartbeat(ctx.run.id, ctx.state.turnCount);

      let outcome: TurnOutcome;
      try {
        outcome = await streamTurn(ctx);
      } catch (error) {
        if (args.signal.aborted) return await settle(ctx, 'CANCELLED', CANCELLED);
        throw error;
      }

      if (outcome.kind === 'cancelled') {
        return await settle(ctx, 'CANCELLED', CANCELLED);
      }

      if (outcome.kind === 'tool_calls') {
        // Continue the loop with tool results appended to the assistant message.
        await runToolCalls(ctx, outcome.calls);
        continue;
      }

      if (outcome.reason) await emit(args, { type: 'finish', reason: outcome.reason });
      return await settle(ctx, 'COMPLETED');
    }

    ctx.log.warn('max turns reached', { turnCount: ctx.state.turnCount, maxTurns });
    const failure: Failure = {
      code: 'max_turns',
      message: `Exceeded max turns (${maxTurns})`,
    };
    await emit(args, { type: 'error', ...failure });
    return await settle(ctx, 'FAILED', failure);
  } catch (error) {
    return await settleFailure(ctx, error);
  }
}

/**
 * Load and validate the run, mark it RUNNING, and resume from whatever the last
 * attempt checkpointed so a Trigger retry picks up mid-conversation.
 */
async function openLoop(args: RunAgentLoopArgs): Promise<LoopContext> {
  const log = args.logger ?? createLogger({ runId: args.agentRunId });

  const run = await AgentRunRepository.findById(args.agentRunId);
  if (!run) {
    throw new ProviderError('invalid_request', `AgentRun not found: ${args.agentRunId}`, {
      retryable: false,
    });
  }

  const modelId = run.modelRequested;
  if (!modelId) {
    throw new ProviderError('invalid_request', 'AgentRun has no modelRequested', {
      retryable: false,
    });
  }

  const provider = resolveProvider(modelId);

  await AgentRunRepository.updateState(run.id, {
    status: 'RUNNING',
    startedAt: run.startedAt ?? now(),
    heartbeatAt: now(),
  });
  await emit(args, { type: 'status', status: 'RUNNING' });

  const assistantMessage = await ensureAssistantMessage(run);

  return {
    args,
    log: log.child({ chatId: run.chatId, runId: run.id }),
    provider,
    modelId,
    run,
    assistantMessageId: assistantMessage.id,
    state: {
      blocks: parseContentBlocks(assistantMessage.content),
      turnCount: run.turnCount ?? 0,
      modelActual: run.modelActual,
      usage: {
        promptTokens: run.promptTokens ?? 0,
        completionTokens: run.completionTokens ?? 0,
        totalTokens: run.totalTokens ?? 0,
      },
    },
  };
}

/** The single terminal path: finalize from current state and shape the result. */
async function settle(
  ctx: LoopContext,
  status: TerminalRunStatus,
  failure?: Failure,
): Promise<RunAgentLoopResult> {
  const { state } = ctx;

  await finalizeAgentRun({
    agentRunId: ctx.run.id,
    status,
    assistantMessageId: ctx.assistantMessageId,
    content: state.blocks,
    modelActual: state.modelActual,
    promptTokens: state.usage.promptTokens,
    completionTokens: state.usage.completionTokens,
    totalTokens: state.usage.totalTokens,
    turnCount: state.turnCount,
    errorCode: failure?.code ?? null,
    errorMessage: failure?.message ?? null,
  });

  return {
    status,
    assistantMessageId: ctx.assistantMessageId,
    turnCount: state.turnCount,
    modelActual: state.modelActual,
  };
}

/** Tell the client what went wrong, then decide whether the run is over. */
async function settleFailure(
  ctx: LoopContext,
  error: unknown,
): Promise<RunAgentLoopResult> {
  if (InsufficientCreditsError.isInsufficientCreditsError(error)) {
    const failure: Failure = {
      code: 'insufficient_credits',
      message: error.message,
    };
    await emit(ctx.args, { type: 'error', ...failure });
    return await settle(ctx, 'FAILED', failure);
  }

  const providerError = ProviderError.isProviderError(error)
    ? error
    : new ProviderError(
        'unknown',
        error instanceof Error ? error.message : 'Agent loop failed',
        { retryable: false, cause: error },
      );

  const failure: Failure = {
    code: providerError.kind,
    message: providerError.message,
  };
  await emit(ctx.args, { type: 'error', ...failure });

  // Retryable errors leave state intact for the task catchError / retry path,
  // which finalizes on final failure. Non-retryable ones end here.
  if (!providerError.retryable) {
    await settle(ctx, 'FAILED', failure);
  }

  throw providerError;
}

/** Events that change durable content and therefore warrant a checkpoint. */
const CHECKPOINT_EVENTS: ReadonlySet<ProviderEvent['type']> = new Set([
  'text-delta',
  'reasoning-delta',
  'tool-call',
  'usage',
]);

/** Stream one provider turn into the assistant blocks, checkpointing as it goes. */
async function streamTurn(ctx: LoopContext): Promise<TurnOutcome> {
  const { args, state } = ctx;

  const restored = await restoreContext({
    chatId: ctx.run.chatId,
    excludeMessageIds: [ctx.assistantMessageId],
  });

  const messages: ProviderMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...restored.messages,
    ...assistantBlocksToProviderMessages(state.blocks),
  ];

  const tools = toProviderTools();
  const calls: ProviderToolCall[] = [];
  let finishReason: FinishReason | null = null;
  let hadDelta = false;

  for await (const event of ctx.provider.stream(
    {
      modelId: ctx.modelId,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    },
    { signal: args.signal },
  )) {
    if (args.signal.aborted) break;

    const handled = await handleProviderEvent(event, {
      blocks: state.blocks,
      emit: args.emit,
      toolCallsThisTurn: calls,
    });

    state.blocks = handled.blocks;
    if (handled.modelActual) state.modelActual = handled.modelActual;
    if (handled.finishReason) finishReason = handled.finishReason;
    if (handled.hadDelta) hadDelta = true;

    if (handled.usage) {
      state.usage = handled.usage;
      await CreditReservationService.ensureReservation({
        userId: ctx.run.userId,
        agentRunId: ctx.run.id,
        needed: estimateModelCredits(state.usage, ctx.modelId),
      });
    }

    if (CHECKPOINT_EVENTS.has(event.type)) {
      await checkpoint(ctx.assistantMessageId, state.blocks);
    }
  }

  await checkpoint(ctx.assistantMessageId, state.blocks);

  // A provider that honours the signal by returning cleanly (rather than
  // throwing) still means cancelled, not finished.
  if (args.signal.aborted) return { kind: 'cancelled' };

  if (!finishReason && !hadDelta && calls.length === 0) {
    throw new ProviderError('empty_stream', 'Provider returned an empty stream', {
      retryable: false,
    });
  }

  if (finishReason === 'tool_calls' || calls.length > 0) {
    return { kind: 'tool_calls', calls };
  }

  return { kind: 'finished', reason: finishReason };
}

/** Run this turn's tool calls in order, appending each result to the blocks. */
async function runToolCalls(
  ctx: LoopContext,
  calls: ProviderToolCall[],
): Promise<void> {
  const { args, state } = ctx;

  for (const call of calls) {
    await emit(args, { type: 'tool-call', ...call });

    const result = await executeTool({
      toolName: call.name,
      argumentsJson: call.argumentsJson,
      toolCallId: call.id,
      agentRunId: ctx.run.id,
      chatId: ctx.run.chatId,
      messageId: ctx.assistantMessageId,
      userId: ctx.run.userId,
      signal: args.signal,
      emit: (part) => emit(args, part),
    });

    state.blocks = appendToolResult(state.blocks, {
      toolUseId: call.id,
      content: result.ok
        ? result.output
        : { error: result.errorCode, message: result.errorMessage },
      isError: !result.ok,
    });

    await emit(args, {
      type: 'tool-result',
      id: call.id,
      name: call.name,
      ok: result.ok,
      output: result.ok ? result.output : undefined,
    });
    await checkpoint(ctx.assistantMessageId, state.blocks);
    await heartbeat(ctx.run.id, state.turnCount);
  }
}

async function ensureAssistantMessage(run: {
  id: string;
  chatId: string;
  userId: string;
}) {
  const existing = await MessageRepository.findAssistantMessageForRun(run.id);
  if (existing) return existing;

  return await MessageRepository.createAssistantMessage({
    chatId: run.chatId,
    userId: run.userId,
    agentRunId: run.id,
  });
}

async function checkpoint(messageId: string, blocks: ContentBlock[]) {
  await MessageRepository.updateStreamingContent(messageId, blocks);
}

async function heartbeat(agentRunId: string, turnCount: number) {
  await AgentRunRepository.updateState(agentRunId, {
    heartbeatAt: now(),
    turnCount,
  });
}

async function emit(
  args: RunAgentLoopArgs,
  part: AgentStreamPart,
): Promise<void> {
  if (!args.emit) return;
  await args.emit(part);
}

async function handleProviderEvent(
  event: ProviderEvent,
  state: {
    blocks: ContentBlock[];
    emit?: RunAgentLoopArgs['emit'];
    toolCallsThisTurn: ProviderToolCall[];
  },
): Promise<{
  blocks: ContentBlock[];
  modelActual?: string;
  usage?: TokenUsage;
  finishReason?: FinishReason;
  hadDelta: boolean;
}> {
  let blocks = state.blocks;
  let hadDelta = false;
  let modelActual: string | undefined;
  let usage: TokenUsage | undefined;
  let finishReason: FinishReason | undefined;

  switch (event.type) {
    case 'model-resolved':
      modelActual = event.model;
      if (state.emit) await state.emit({ type: 'model-resolved', model: event.model });
      break;
    case 'text-delta':
      blocks = mergeTextDelta(blocks, event.text);
      hadDelta = true;
      if (state.emit) await state.emit({ type: 'text-delta', text: event.text });
      break;
    case 'reasoning-delta':
      blocks = mergeThinkingDelta(blocks, event.text);
      hadDelta = true;
      if (state.emit) await state.emit({ type: 'reasoning-delta', text: event.text });
      break;
    case 'tool-call':
      blocks = appendToolUse(blocks, event);
      state.toolCallsThisTurn.push({
        id: event.id,
        name: event.name,
        argumentsJson: event.argumentsJson,
      });
      hadDelta = true;
      break;
    case 'usage':
      usage = {
        promptTokens: event.promptTokens,
        completionTokens: event.completionTokens,
        totalTokens: event.totalTokens,
      };
      blocks = upsertUsage(blocks, usage);
      if (state.emit) await state.emit({ type: 'usage', ...usage });
      break;
    case 'finish':
      finishReason = event.reason;
      break;
  }

  return { blocks, modelActual, usage, finishReason, hadDelta };
}
