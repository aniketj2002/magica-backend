import { isUniqueConstraintViolation } from '@prisma/orm-family-sql/errors';
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types';
import { wait } from '@trigger.dev/sdk';
import { AppError } from '@/lib/errors';
import { now } from '@/lib/temporal';
import { db } from '@/prisma/db';
import { AgentRunRepository } from '@/repositories/agentRun.repository';
import type { ToolEmitPart } from './types';

export const TOOL_APPROVAL_WAITPOINT_TYPE = 'tool_approval';
export const TOOL_APPROVAL_TIMEOUT = '1h' as const;

export type ToolApprovalDecision = {
  approved: boolean;
};

export type ApprovalOutcome = 'approved' | 'rejected' | 'timed_out';

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

/**
 * Park the agent run until the user approves or rejects a paid tool call
 * (or the 1h wait token expires). Credits are NOT reserved while waiting.
 */
export async function requestToolApproval(opts: {
  agentRunId: string;
  toolCallId: string;
  toolInvocationId: string;
  toolName: string;
  credits: number;
  emit?: (part: ToolEmitPart) => void | Promise<void>;
}): Promise<ApprovalOutcome> {
  const token = await wait.createToken({
    timeout: TOOL_APPROVAL_TIMEOUT,
    idempotencyKey: `tool-approval:${opts.toolCallId}`,
    tags: [`run:${opts.agentRunId}`],
  });

  await persistWaitpoint({
    agentRunId: opts.agentRunId,
    tokenId: token.id,
    input: {
      toolInvocationId: opts.toolInvocationId,
      toolCallId: opts.toolCallId,
      toolName: opts.toolName,
      credits: opts.credits,
    },
  });

  await db.orm.public.ToolInvocation.where({ id: opts.toolInvocationId }).update({
    waitpointToken: token.id,
    status: 'QUEUED',
  });

  await AgentRunRepository.updateState(opts.agentRunId, {
    status: 'WAITING',
    heartbeatAt: now(),
  });

  await opts.emit?.({
    type: 'tool-approval-required',
    id: opts.toolCallId,
    name: opts.toolName,
    credits: opts.credits,
  });

  const res = await wait.forToken<ToolApprovalDecision>(token);

  if (!res.ok) {
    await markWaitpointExpired(token.id);
    return 'timed_out';
  }

  const decision = res.output ?? { approved: false };
  await markWaitpointResumed(token.id, decision);

  return decision.approved ? 'approved' : 'rejected';
}

/**
 * Complete a pending tool-approval waitpoint. Ownership checked via run.userId.
 */
export async function completeToolApproval(opts: {
  userId: string;
  runId: string;
  toolCallId: string;
  approved: boolean;
}): Promise<{ approved: boolean; toolCallId: string }> {
  const run = await AgentRunRepository.findByIdForUser(opts.runId, opts.userId);
  if (!run) throw AppError.notFound();

  const invocation = await db.orm.public.ToolInvocation.where({
    idempotencyKey: opts.toolCallId,
  }).first();

  if (!invocation || invocation.agentRunId !== run.id) {
    throw AppError.notFound();
  }

  if (invocation.status !== 'QUEUED' || !invocation.waitpointToken) {
    throw AppError.conflict(
      'approval_not_pending',
      'Tool call is not awaiting approval',
    );
  }

  const decision: ToolApprovalDecision = { approved: opts.approved };
  await wait.completeToken(invocation.waitpointToken, decision);

  return { approved: opts.approved, toolCallId: opts.toolCallId };
}

async function persistWaitpoint(opts: {
  agentRunId: string;
  tokenId: string;
  input: Record<string, unknown>;
}) {
  try {
    await db.orm.public.Waitpoint.create({
      agentRunId: opts.agentRunId,
      token: opts.tokenId,
      type: TOOL_APPROVAL_WAITPOINT_TYPE,
      status: 'PENDING',
      input: asJson(opts.input),
      updatedAt: now(),
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return;
    }
    throw error;
  }
}

async function markWaitpointResumed(
  tokenId: string,
  decision: ToolApprovalDecision,
) {
  await db.orm.public.Waitpoint.where({ token: tokenId }).update({
    status: 'RESUMED',
    response: asJson(decision),
    resumedAt: now(),
    updatedAt: now(),
  });
}

async function markWaitpointExpired(tokenId: string) {
  await db.orm.public.Waitpoint.where({ token: tokenId }).update({
    status: 'EXPIRED',
    updatedAt: now(),
  });
}
