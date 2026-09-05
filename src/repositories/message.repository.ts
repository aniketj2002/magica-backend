import type { Temporal } from '@js-temporal/polyfill';
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types';
import { db } from '@/prisma/db';
import type { OrmClient } from '@/prisma/orm';
import { now } from '@/lib/temporal';
import type { ContentBlock } from '@/agent/content';

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

export type MessageRow = NonNullable<
  Awaited<ReturnType<typeof MessageRepository.findById>>
>;

export const MessageRepository = {
  async findById(messageId: string) {
    return await db.orm.public.Message.where({ id: messageId }).first();
  },

  async createUserMessage(
    opts: {
      chatId: string;
      userId: string;
      content: ContentBlock[];
    },
    client: OrmClient = db,
  ) {
    return await client.orm.public.Message.create({
      chatId: opts.chatId,
      userId: opts.userId,
      role: 'USER',
      status: 'COMPLETED',
      content: asJson(opts.content),
      updatedAt: now(),
    });
  },

  async listForChat(opts: {
    chatId: string;
    limit: number;
    /** Newest-first keyset cursor on (createdAt, id). */
    cursor?: { createdAt: Temporal.Instant; id: string } | null;
  }) {
    let query = db.orm.public.Message.where({ chatId: opts.chatId }).orderBy([
      (m) => m.createdAt.desc(),
      (m) => m.id.desc(),
    ]);

    if (opts.cursor) {
      query = query.cursor({
        createdAt: opts.cursor.createdAt,
        id: opts.cursor.id,
      });
    }

    return await query.limit(opts.limit).all();
  },

  async findContextMessages(chatId: string, opts?: { limit?: number }) {
    let query = db.orm.public.Message.where({ chatId })
      .where((m) => m.status.in(['COMPLETED', 'STREAMING']))
      .orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()]);
    const limit = opts?.limit ?? 5;
    query = query.limit(limit);
    
    return await query.all();
  },

  async findAssistantMessageForRun(agentRunId: string) {
    return await db.orm.public.Message.where({ agentRunId })
      .where({ role: 'ASSISTANT' })
      .orderBy([(m) => m.createdAt.asc(), (m) => m.id.asc()])
      .first();
  },

  async findLastAssistantMessageForRun(agentRunId: string) {
    return await db.orm.public.Message.where({ agentRunId })
      .where({ role: 'ASSISTANT' })
      .orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()])
      .first();
  },

  async createAssistantMessage(opts: {
    chatId: string;
    userId: string;
    agentRunId: string;
  }) {
    return await db.orm.public.Message.create({
      chatId: opts.chatId,
      userId: opts.userId,
      agentRunId: opts.agentRunId,
      role: 'ASSISTANT',
      status: 'STREAMING',
      content: asJson([]),
      updatedAt: now(),
    });
  },

  async updateStreamingContent(messageId: string, content: ContentBlock[]) {
    const existing = await db.orm.public.Message.where({ id: messageId }).first();
    // Cancel/finalize may have already closed the message while a Magica wait
    // was suspended — never resurrect STREAMING after a terminal status.
    if (
      existing &&
      (existing.status === 'COMPLETED' ||
        existing.status === 'FAILED' ||
        existing.status === 'CANCELLED')
    ) {
      return existing;
    }
    return await db.orm.public.Message.where({ id: messageId }).update({
      content: asJson(content),
      status: 'STREAMING',
      updatedAt: now(),
    });
  },

  async updateMessageStatus(messageId: string, status: any, content?: ContentBlock[]) {
    return await db.orm.public.Message.where({ id: messageId }).update({
      status,
      updatedAt: now(),
      ...(content !== undefined ? { content: asJson(content) } : {}),
    });
  },
};
