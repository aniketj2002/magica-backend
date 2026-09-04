import { db } from '@/prisma/db';
import type { OrmClient } from '@/prisma/orm';
import { now } from '@/lib/temporal';

export type AgentRunRow = NonNullable<
  Awaited<ReturnType<typeof AgentRunRepository.findById>>
>;

export const AgentRunRepository = {
  async findById(agentRunId: string) {
    return await db.orm.public.AgentRun.where({ id: agentRunId }).first();
  },

  async findByIdForUser(agentRunId: string, userId: string) {
    return await db.orm.public.AgentRun.where({ id: agentRunId, userId }).first();
  },

  async findByIdempotencyKey(idempotencyKey: string) {
    return await db.orm.public.AgentRun.where({ idempotencyKey }).first();
  },

  async create(
    opts: {
      chatId: string;
      userId: string;
      messageId: string;
      modelRequested: string;
      idempotencyKey?: string | null;
    },
    client: OrmClient = db,
  ) {
    return await client.orm.public.AgentRun.create({
      chatId: opts.chatId,
      userId: opts.userId,
      messageId: opts.messageId,
      status: 'QUEUED',
      modelRequested: opts.modelRequested,
      idempotencyKey: opts.idempotencyKey ?? null,
      turnCount: 0,
      updatedAt: now(),
    });
  },

  async setTriggerRunId(agentRunId: string, triggerRunId: string, triggerTaskId: string) {
    return await db.orm.public.AgentRun.where({ id: agentRunId }).update({
      triggerRunId,
      triggerTaskId,
      updatedAt: now(),
    });
  },

  async updateState(agentRunId: string, data: Partial<{
    status: any;
    modelActual: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    turnCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: unknown;
    completedAt: unknown;
    heartbeatAt: unknown;
  }>) {
    const updatedAt = now();
    return await db.orm.public.AgentRun.where({ id: agentRunId }).update({
      ...data,
      updatedAt,
    });
  },

  async updateHeartbeat(agentRunId: string) {
    return await db.orm.public.AgentRun.where({ id: agentRunId }).update({
      heartbeatAt: now(),
    });
  },
};
