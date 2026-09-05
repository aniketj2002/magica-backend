import { isUniqueConstraintViolation } from '@prisma/orm-family-sql/errors';
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types';
import { tasks, wait } from '@trigger.dev/sdk';
import type { z } from 'zod';
import { env } from '@/lib/env';
import { now } from '@/lib/temporal';
import { db } from '@/prisma/db';
import {
  estimateCredits,
  getNodeRun,
  isMagicaVcrMock,
  runNode,
  toAppCredits,
  type MagicaNodeRun,
} from '@/providers/magica';
import { AgentRunRepository } from '@/repositories/agentRun.repository';
import { CreditReservationService } from '@/services/creditReservation.service';
import { MediaService } from '@/services/media.service';
import {
  MAGICA_POLL_TASK_ID,
  magicaPollTask,
  type MagicaPollPayload,
} from '@/trigger/magica-poll.task';
import type { ToolContext, ToolDefinition, ToolPricing } from '../types';

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

const WAITPOINT_TYPE = 'magica_node_run';
const WAIT_TIMEOUT = '15m';

const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELED',
]);

export type CreateMagicaNodeToolOptions<I, O> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  pricing: ToolPricing;
  /** GeneratedAsset type for mirrored outputs. */
  assetType: 'IMAGE' | 'VIDEO';
  /** Magica output field that holds URL arrays. */
  outputUrlKey: 'image_url' | 'video_url';
  resolveSubModelId?: (input: I) => string | undefined;
  toNodeInput: (input: I) => Record<string, unknown>;
  mapOutput: (run: MagicaNodeRun) => O;
};

/**
 * Shared Magica node tool: wait token → runNode → magica-poll (every 20s) →
 * wait.forToken → top up to actual credits → settle on COMPLETED. The
 * estimated cost is already reserved by `executeTool` before we get here.
 */
export function createMagicaNodeTool<I, O>(
  opts: CreateMagicaNodeToolOptions<I, O>,
): ToolDefinition<I, O> {
  return {
    name: opts.name,
    description: opts.description,
    inputSchema: opts.inputSchema,
    outputSchema: opts.outputSchema,
    pricing: opts.pricing,
    async estimateCost(input) {
      const subModelId = opts.resolveSubModelId?.(input);
      const { microcredits } = await estimateCredits([
        {
          type: opts.pricing.nodeType,
          data: opts.toNodeInput(input),
          ...(subModelId ? { subModelId } : {}),
        },
      ]);
      return { microcredits, credits: toAppCredits(microcredits) };
    },
    async execute(input, ctx) {
      return runMagicaNode(opts, input, ctx);
    },
  };
}

async function runMagicaNode<I, O>(
  opts: CreateMagicaNodeToolOptions<I, O>,
  input: I,
  ctx: ToolContext,
): Promise<O> {
  if (!env.APP_PUBLIC_URL) {
    throw new Error('APP_PUBLIC_URL is required for Magica node tools');
  }

  const subModelId = opts.resolveSubModelId?.(input);
  const nodeInput = opts.toNodeInput(input);

  const token = await wait.createToken({
    timeout: WAIT_TIMEOUT,
    idempotencyKey: `magica:${ctx.toolCallId}`,
    tags: [`run:${ctx.agentRunId}`],
  });

  await persistWaitpoint({
    agentRunId: ctx.agentRunId,
    tokenId: token.id,
    input: {
      nodeType: opts.pricing.nodeType,
      subModelId: subModelId ?? null,
      toolInvocationId: ctx.toolInvocationId,
      toolCallId: ctx.toolCallId,
    },
  });

  const accepted = await runNode({
    nodeType: opts.pricing.nodeType,
    subModelId,
    input: nodeInput,
    webhook: {
      url: `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/api/webhooks/magica`,
      events: ['run.completed', 'run.failed'],
      metadata: {
        toolInvocationId: ctx.toolInvocationId,
        waitpointTokenId: token.id,
        agentRunId: ctx.agentRunId,
      },
    },
  });

  await db.orm.public.ToolInvocation.where({ id: ctx.toolInvocationId }).update({
    providerRunId: accepted.runId,
    waitpointToken: token.id,
    subModelId: subModelId ?? null,
    status: 'RUNNING',
  });

  await AgentRunRepository.updateState(ctx.agentRunId, {
    status: 'WAITING',
    heartbeatAt: now(),
  });

  await ctx.emit?.({
    type: 'tool-progress',
    id: ctx.toolCallId,
    name: opts.name,
    status: 'WAITING',
  });

  const pollPayload: MagicaPollPayload = {
    providerRunId: accepted.runId,
    waitpointTokenId: token.id,
    toolInvocationId: ctx.toolInvocationId,
  };
  await tasks.trigger<typeof magicaPollTask>(
    MAGICA_POLL_TASK_ID,
    pollPayload,
    { idempotencyKey: `magica-poll:${ctx.toolCallId}` },
  );

  // Mock mode: complete the wait token immediately so we don't burn the poll
  // backoff schedule. Poll/webhook completion of an already-done token is a no-op.
  if (isMagicaVcrMock()) {
    const mocked = await getNodeRun(accepted.runId);
    if (TERMINAL_STATUSES.has(mocked.status)) {
      await wait.completeToken(token.id, mocked);
    }
  }

  const res = await wait.forToken<MagicaNodeRun>(token);
  if (!res.ok) {
    await AgentRunRepository.updateState(ctx.agentRunId, {
      status: 'RUNNING',
      heartbeatAt: now(),
    });
    await markWaitpointExpired(token.id);
    throw new Error(
      res.error?.message ?? `Magica run timed out for ${opts.pricing.nodeType}`,
    );
  }

  const run = res.output ?? (await getNodeRun(accepted.runId));

  await markWaitpointResumed(token.id, run);
  await AgentRunRepository.updateState(ctx.agentRunId, {
    status: 'RUNNING',
    heartbeatAt: now(),
  });

  if (!TERMINAL_STATUSES.has(run.status)) {
    await ctx.emit?.({
      type: 'tool-progress',
      id: ctx.toolCallId,
      name: opts.name,
      status: run.status,
    });
    throw new Error(`Magica run ${run.id} resumed with non-terminal status ${run.status}`);
  }

  if (run.status !== 'COMPLETED') {
    await ctx.emit?.({
      type: 'tool-progress',
      id: ctx.toolCallId,
      name: opts.name,
      status: run.status,
    });
    throw new Error(
      run.userMessage ??
        run.error ??
        `Magica run ${run.id} ended with status ${run.status}`,
    );
  }

  // The estimate was already held before runNode; top up only when Magica's
  // actual creditUsed came in above it. No-op when actual <= estimate.
  const microcredits = run.creditUsed ?? 0;
  await CreditReservationService.ensureReservation({
    userId: ctx.userId,
    agentRunId: ctx.agentRunId,
    needed: toAppCredits(microcredits),
  });
  await CreditReservationService.settleToolInvocation({
    toolInvocationId: ctx.toolInvocationId,
    microcredits,
  });

  try {
    const mapped = opts.mapOutput(run);
    const output = await rewriteOutputWithDurableUrls(opts, mapped, ctx);
    await ctx.emit?.({
      type: 'tool-progress',
      id: ctx.toolCallId,
      name: opts.name,
      status: 'COMPLETED',
    });
    return output;
  } catch (error) {
    await ctx.emit?.({
      type: 'tool-progress',
      id: ctx.toolCallId,
      name: opts.name,
      status: 'FAILED',
    });
    throw error;
  }
}

async function rewriteOutputWithDurableUrls<I, O>(
  opts: CreateMagicaNodeToolOptions<I, O>,
  mapped: O,
  ctx: ToolContext,
): Promise<O> {
  if (!mapped || typeof mapped !== 'object') return mapped;

  const record = mapped as Record<string, unknown>;
  const raw = record[opts.outputUrlKey];
  const sourceUrls = Array.isArray(raw)
    ? raw.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : typeof raw === 'string'
      ? [raw]
      : [];

  if (sourceUrls.length === 0) return mapped;

  const durable = await MediaService.mirrorToolOutputUrls({
    sourceUrls,
    userId: ctx.userId,
    chatId: ctx.chatId,
    messageId: ctx.messageId,
    toolInvocationId: ctx.toolInvocationId,
    assetType: opts.assetType,
  });

  return {
    ...record,
    [opts.outputUrlKey]: durable,
  } as O;
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
      type: WAITPOINT_TYPE,
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

async function markWaitpointResumed(tokenId: string, run: MagicaNodeRun) {
  await db.orm.public.Waitpoint.where({ token: tokenId }).update({
    status: 'RESUMED',
    response: asJson(run),
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

/**
 * Extract URL arrays from Magica output payloads.
 * Prefer the tool-specific key (`image_url` / `video_url`); fall back to
 * Magica's generic `result` field (e.g. gpt_image_2).
 */
export function extractUrlArray(
  output: unknown,
  key: 'image_url' | 'video_url',
): string[] {
  if (!output || typeof output !== 'object') return [];
  const record = output as Record<string, unknown>;
  for (const candidate of [key, 'result'] as const) {
    const value = record[candidate];
    if (typeof value === 'string' && value.length > 0) return [value];
    if (Array.isArray(value)) {
      const urls = value.filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      );
      if (urls.length > 0) return urls;
    }
  }
  return [];
}
