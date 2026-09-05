import {
  isUniqueConstraintViolation,
} from '@prisma/orm-family-sql/errors';
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types';
import { db } from '@/prisma/db';
import { now } from '@/lib/temporal';
import { createLogger } from '@/lib/logger';
import { InsufficientCreditsError } from '@/lib/credits-errors';
import { fromDecimal, toDecimalString } from '@/providers/magica/credits';
import { CreditReservationService } from '@/services/creditReservation.service';
import { AgentRunRepository } from '@/repositories/agentRun.repository';
import { requestToolApproval } from './approval';
import { getTool } from './registry';
import type { ToolContext, ToolEmitPart } from './types';

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

export type ToolExecuteResult =
  | {
      ok: true;
      toolName: string;
      toolCallId: string;
      invocationId: string;
      output: unknown;
      estimatedCredits: number;
    }
  | {
      ok: false;
      toolName: string;
      toolCallId: string;
      invocationId: string | null;
      errorCode: string;
      errorMessage: string;
    };

export type ExecuteToolArgs = {
  toolName: string;
  /** Raw JSON string from the provider tool-call arguments. */
  argumentsJson: string;
  toolCallId: string;
  agentRunId: string;
  chatId: string;
  messageId: string;
  userId: string;
  signal: AbortSignal;
  emit?: (part: ToolEmitPart) => void | Promise<void>;
};

/**
 * Zod-in → estimate → (paid: user approval) → reserve → run → Zod-out.
 * Owns ToolInvocation persistence so individual tools never mutate chat/run state.
 */
export async function executeTool(args: ExecuteToolArgs): Promise<ToolExecuteResult> {
  const logger = createLogger({
    runId: args.agentRunId,
    chatId: args.chatId,
    messageId: args.messageId,
  });

  const tool = getTool(args.toolName);
  if (!tool) {
    const invocation = await createFailedInvocation(args, {
      errorCode: 'tool_not_found',
      errorMessage: `Unknown tool: ${args.toolName}`,
      input: null,
    });
    return {
      ok: false,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      invocationId: invocation?.id ?? null,
      errorCode: 'tool_not_found',
      errorMessage: `Unknown tool: ${args.toolName}`,
    };
  }

  let rawInput: unknown;
  try {
    rawInput = args.argumentsJson.trim() === '' ? {} : JSON.parse(args.argumentsJson);
  } catch {
    const invocation = await createFailedInvocation(args, {
      errorCode: 'invalid_arguments_json',
      errorMessage: 'Tool arguments are not valid JSON',
      input: { raw: args.argumentsJson },
    });
    return {
      ok: false,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      invocationId: invocation?.id ?? null,
      errorCode: 'invalid_arguments_json',
      errorMessage: 'Tool arguments are not valid JSON',
    };
  }

  const parsedInput = tool.inputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const invocation = await createFailedInvocation(args, {
      errorCode: 'invalid_arguments',
      errorMessage: parsedInput.error.message,
      input: rawInput,
    });
    return {
      ok: false,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      invocationId: invocation?.id ?? null,
      errorCode: 'invalid_arguments',
      errorMessage: parsedInput.error.message,
    };
  }

  let estimatedCredits = 0;
  let estimatedMicrocredits = 0;
  try {
    const cost = await tool.estimateCost(parsedInput.data);
    estimatedCredits = cost.credits;
    estimatedMicrocredits = cost.microcredits;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Credit estimate failed';
    const invocation = await createFailedInvocation(args, {
      errorCode: 'estimate_failed',
      errorMessage: message,
      input: parsedInput.data,
    });
    return {
      ok: false,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      invocationId: invocation?.id ?? null,
      errorCode: 'estimate_failed',
      errorMessage: message,
    };
  }

  const startedAt = now();
  const needsApproval = estimatedCredits > 0;

  let invocationId: string;
  try {
    const created = await db.orm.public.ToolInvocation.create({
      agentRunId: args.agentRunId,
      chatId: args.chatId,
      messageId: args.messageId,
      toolName: args.toolName,
      status: needsApproval ? 'QUEUED' : 'RUNNING',
      input: asJson(parsedInput.data),
      estimatedCredits: toDecimalString(estimatedCredits),
      estimatedMicrocredits,
      provider: tool.pricing.provider,
      idempotencyKey: args.toolCallId,
      startedAt: needsApproval ? null : startedAt,
    });
    invocationId = created.id;
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const existing = await db.orm.public.ToolInvocation.where({
        idempotencyKey: args.toolCallId,
      }).first();
      if (existing?.status === 'COMPLETED') {
        return {
          ok: true,
          toolName: args.toolName,
          toolCallId: args.toolCallId,
          invocationId: existing.id,
          output: existing.output,
          estimatedCredits: fromDecimal(existing.estimatedCredits) || estimatedCredits,
        };
      }
      if (existing?.status === 'FAILED' || existing?.status === 'CANCELLED') {
        return {
          ok: false,
          toolName: args.toolName,
          toolCallId: args.toolCallId,
          invocationId: existing.id,
          errorCode: existing.errorCode ?? 'tool_failed',
          errorMessage: existing.errorMessage ?? 'Tool previously failed',
        };
      }
      return {
        ok: false,
        toolName: args.toolName,
        toolCallId: args.toolCallId,
        invocationId: existing?.id ?? null,
        errorCode: 'tool_invocation_in_progress',
        errorMessage: 'Tool invocation already in progress',
      };
    }
    throw error;
  }

  if (needsApproval) {
    const outcome = await requestToolApproval({
      agentRunId: args.agentRunId,
      toolCallId: args.toolCallId,
      toolInvocationId: invocationId,
      toolName: args.toolName,
      credits: estimatedCredits,
      emit: args.emit,
    });

    if (outcome !== 'approved') {
      const errorCode =
        outcome === 'timed_out' ? 'approval_timed_out' : 'approval_rejected';
      const errorMessage =
        outcome === 'timed_out'
          ? 'Tool approval timed out'
          : 'Tool call rejected by user';
      await markCancelled(invocationId, {
        errorCode,
        errorMessage,
      });
      await AgentRunRepository.updateState(args.agentRunId, {
        status: 'RUNNING',
        heartbeatAt: now(),
      });
      return {
        ok: false,
        toolName: args.toolName,
        toolCallId: args.toolCallId,
        invocationId,
        errorCode,
        errorMessage,
      };
    }

    // Approved — reserve before any provider work, then mark running.
    try {
      await CreditReservationService.ensureReservation({
        userId: args.userId,
        agentRunId: args.agentRunId,
        needed: estimatedCredits,
      });
    } catch (error) {
      if (InsufficientCreditsError.isInsufficientCreditsError(error)) {
        await markFailed(invocationId, startedAt, {
          errorCode: 'insufficient_credits',
          errorMessage: error.message,
        });
        throw error;
      }
      throw error;
    }

    const runStartedAt = now();
    await db.orm.public.ToolInvocation.where({ id: invocationId }).update({
      status: 'RUNNING',
      startedAt: runStartedAt,
    });
    await AgentRunRepository.updateState(args.agentRunId, {
      status: 'RUNNING',
      heartbeatAt: runStartedAt,
    });
    await args.emit?.({
      type: 'tool-progress',
      id: args.toolCallId,
      name: args.toolName,
      status: 'RUNNING',
    });
  } else {
    // Free tools — no approval, no balance hold (needed: 0 is a no-op).
    await CreditReservationService.ensureReservation({
      userId: args.userId,
      agentRunId: args.agentRunId,
      needed: 0,
    });
  }

  const ctx: ToolContext = {
    agentRunId: args.agentRunId,
    chatId: args.chatId,
    messageId: args.messageId,
    userId: args.userId,
    signal: args.signal,
    logger,
    toolCallId: args.toolCallId,
    toolInvocationId: invocationId,
    emit: args.emit,
  };

  const execStartedAt = now();

  try {
    const rawOutput = await tool.execute(parsedInput.data, ctx);
    const parsedOutput = tool.outputSchema.safeParse(rawOutput);
    if (!parsedOutput.success) {
      await markFailed(invocationId, execStartedAt, {
        errorCode: 'invalid_output',
        errorMessage: parsedOutput.error.message,
      });
      return {
        ok: false,
        toolName: args.toolName,
        toolCallId: args.toolCallId,
        invocationId,
        errorCode: 'invalid_output',
        errorMessage: parsedOutput.error.message,
      };
    }

    const completedAt = now();
    const durationMs = Math.max(
      0,
      Number(completedAt.epochMilliseconds - execStartedAt.epochMilliseconds),
    );

    await db.orm.public.ToolInvocation.where({ id: invocationId }).update({
      status: 'COMPLETED',
      output: asJson(parsedOutput.data),
      durationMs,
      completedAt,
    });

    return {
      ok: true,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      invocationId,
      output: parsedOutput.data,
      estimatedCredits,
    };
  } catch (error) {
    if (InsufficientCreditsError.isInsufficientCreditsError(error)) {
      await markFailed(invocationId, execStartedAt, {
        errorCode: 'insufficient_credits',
        errorMessage: error.message,
      });
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Tool execution failed';
    await markFailed(invocationId, execStartedAt, {
      errorCode: 'tool_execution_error',
      errorMessage: message,
    });
    logger.error('tool execution failed', {
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      error: message,
    });
    return {
      ok: false,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      invocationId,
      errorCode: 'tool_execution_error',
      errorMessage: message,
    };
  }
}

async function createFailedInvocation(
  args: ExecuteToolArgs,
  opts: { errorCode: string; errorMessage: string; input: unknown },
) {
  try {
    return await db.orm.public.ToolInvocation.create({
      agentRunId: args.agentRunId,
      chatId: args.chatId,
      messageId: args.messageId,
      toolName: args.toolName,
      status: 'FAILED',
      input: asJson(opts.input ?? null),
      errorCode: opts.errorCode,
      errorMessage: opts.errorMessage,
      idempotencyKey: args.toolCallId,
      startedAt: now(),
      completedAt: now(),
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return await db.orm.public.ToolInvocation.where({
        idempotencyKey: args.toolCallId,
      }).first();
    }
    throw error;
  }
}

async function markFailed(
  invocationId: string,
  startedAt: ReturnType<typeof now>,
  opts: { errorCode: string; errorMessage: string },
) {
  const completedAt = now();
  const durationMs = Math.max(
    0,
    Number(completedAt.epochMilliseconds - startedAt.epochMilliseconds),
  );
  await db.orm.public.ToolInvocation.where({ id: invocationId }).update({
    status: 'FAILED',
    errorCode: opts.errorCode,
    errorMessage: opts.errorMessage,
    durationMs,
    completedAt,
  });
}

async function markCancelled(
  invocationId: string,
  opts: { errorCode: string; errorMessage: string },
) {
  await db.orm.public.ToolInvocation.where({ id: invocationId }).update({
    status: 'CANCELLED',
    errorCode: opts.errorCode,
    errorMessage: opts.errorMessage,
    completedAt: now(),
  });
}
