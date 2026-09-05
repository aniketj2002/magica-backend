import { isUniqueConstraintViolation } from '@prisma/orm-family-sql/errors';
import { auth, tasks } from '@trigger.dev/sdk';
import { AppError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { decodeCursor, encodeCursor, instantToIso } from '@/lib/cursor';
import { deriveChatTitle } from '@/lib/chatTitle';
import { now } from '@/lib/temporal';
import { db } from '@/prisma/db';
import { assertAllowedModel, ALLOWED_MODELS } from '@/providers/llm/policy';
import { ChatRepository } from '@/repositories/chat.repository';
import { MessageRepository } from '@/repositories/message.repository';
import { AgentRunRepository } from '@/repositories/agentRun.repository';
import {
  CreditService,
  DEFAULT_RUN_CREDIT_RESERVATION,
} from '@/services/credit.service';
import { estimateModelCredits } from '@/services/modelCredits.policy';
import { AttachmentService } from '@/services/attachment.service';
import { AttachmentRepository } from '@/repositories/attachment.repository';
import {
  AGENT_RUN_TASK_ID,
  agentRunTriggerOptions,
} from '@/trigger/queues';
import { agentStream } from '@/trigger/streams';
import type { agentRunTask } from '@/trigger/agent-run.task';
import {
  markToolUseAwaitingApproval,
  parseContentBlocks,
  type ContentBlock,
} from '@/agent/content';
import { TOOL_APPROVAL_WAITPOINT_TYPE } from '@/tools/approval';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_MODEL = ALLOWED_MODELS[0];

export type SendMessageInput = {
  chatId: string;
  userId: string;
  text: string;
  modelId?: string;
  idempotencyKey?: string | null;
  /** Completed attachment ids owned by this user+chat; URLs injected into context. */
  attachmentIds?: string[];
};

export type SendMessageResult = {
  chatId: string;
  messageId: string;
  runId: string;
  realtime: {
    runId: string;
    streamId: string;
    publicAccessToken: string;
  };
};

export const ChatMessageService = {
  async listMessages(opts: {
    chatId: string;
    userId: string;
    limit?: number;
    cursor?: string | null;
  }) {
    const chat = await ChatRepository.findByIdForUser(opts.chatId, opts.userId);
    if (!chat) throw AppError.notFound();

    const limit = clampLimit(opts.limit);
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
    const rows = await MessageRepository.listForChat({
      chatId: opts.chatId,
      limit: limit + 1,
      cursor,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeCursor({
            createdAt: page[page.length - 1]!.createdAt,
            id: page[page.length - 1]!.id,
          })
        : null;

    return {
      items: await serializeMessagesWithPendingApprovals(page),
      nextCursor,
    };
  },

  /**
   * Transactional send: user message + AgentRun + CAS chat lock + credit
   * reservation, then post-commit idempotent Trigger dispatch.
   */
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const modelId = input.modelId ?? DEFAULT_MODEL;
    assertAllowedModel(modelId);

    const text = input.text.trim();
    if (!text) {
      throw AppError.validation('Message text is required');
    }

    const idempotencyKey = input.idempotencyKey?.trim() || null;
    const log = createLogger({ chatId: input.chatId });
    const attachmentIds = input.attachmentIds ?? [];

    // Fast path: repeated Idempotency-Key returns the existing run.
    if (idempotencyKey) {
      const existing = await AgentRunRepository.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.chatId !== input.chatId || existing.userId !== input.userId) {
          throw AppError.conflict('conflict', 'Idempotency key already used');
        }
        return await dispatchAndTokenize({
          chatId: existing.chatId,
          messageId: existing.messageId,
          runId: existing.id,
          triggerRunId: existing.triggerRunId,
        });
      }
    }

    const attachments = await AttachmentService.resolveForMessage({
      attachmentIds,
      userId: input.userId,
      chatId: input.chatId,
    });
    const content = buildUserContent(
      text,
      attachments.map((a) => a.resultUrl!).filter(Boolean),
    );

    let created: { messageId: string; runId: string };
    try {
      created = await db.transaction(async (tx) => {
        const chat = await tx.orm.public.Chat.where({
          id: input.chatId,
          userId: input.userId,
        }).first();
        if (!chat) throw AppError.notFound();

        // Attachment uploads create the chat early with a null title — fill it
        // from the first user message text when still untitled.
        if (!chat.title?.trim()) {
          await tx.orm.public.Chat.where({ id: chat.id }).update({
            title: deriveChatTitle(text),
            updatedAt: now(),
          });
        }

        const message = await MessageRepository.createUserMessage(
          {
            chatId: input.chatId,
            userId: input.userId,
            content,
          },
          tx,
        );

        if (attachments.length > 0) {
          await AttachmentRepository.linkToMessage(
            {
              ids: attachments.map((a) => a.id),
              messageId: message.id,
            },
            tx,
          );
        }

        const run = await AgentRunRepository.create(
          {
            chatId: input.chatId,
            userId: input.userId,
            messageId: message.id,
            modelRequested: modelId,
            idempotencyKey,
          },
          tx,
        );


        // Free models (OpenRouter today) settle at 0 — no reservation hold.
        // Paid models reserve DEFAULT_RUN_CREDIT_RESERVATION at send.
        const modelCost = estimateModelCredits({}, modelId);
        await CreditService.reserveForRun(
          {
            userId: input.userId,
            agentRunId: run.id,
            amount: modelCost > 0 ? DEFAULT_RUN_CREDIT_RESERVATION : 0,
          },
          tx,
        );

        return { messageId: message.id, runId: run.id };
      });
    } catch (error) {
      if (idempotencyKey && isUniqueConstraintViolation(error)) {
        const existing = await AgentRunRepository.findByIdempotencyKey(idempotencyKey);
        if (existing && existing.chatId === input.chatId && existing.userId === input.userId) {
          return await dispatchAndTokenize({
            chatId: existing.chatId,
            messageId: existing.messageId,
            runId: existing.id,
            triggerRunId: existing.triggerRunId,
          });
        }
      }
      throw error;
    }

    log.info('message accepted', {
      messageId: created.messageId,
      runId: created.runId,
    });

    return await dispatchAndTokenize({
      chatId: input.chatId,
      messageId: created.messageId,
      runId: created.runId,
      triggerRunId: null,
    });
  },
};

async function dispatchAndTokenize(opts: {
  chatId: string;
  messageId: string;
  runId: string;
  triggerRunId: string | null;
}): Promise<SendMessageResult> {
  let triggerRunId = opts.triggerRunId;

  if (!triggerRunId) {
    const handle = await tasks.trigger<typeof agentRunTask>(
      AGENT_RUN_TASK_ID,
      { agentRunId: opts.runId },
      agentRunTriggerOptions(opts.chatId, opts.runId),
    );
    triggerRunId = handle.id;
    await AgentRunRepository.setTriggerRunId(
      opts.runId,
      triggerRunId,
      AGENT_RUN_TASK_ID,
    );
  }

  const publicAccessToken = await auth.createPublicToken({
    scopes: {
      read: {
        runs: [triggerRunId],
      },
    },
    expirationTime: '1h',
  });

  return {
    chatId: opts.chatId,
    messageId: opts.messageId,
    runId: opts.runId,
    realtime: {
      runId: triggerRunId,
      streamId: agentStream.id,
      publicAccessToken,
    },
  };
}

function buildUserContent(text: string, attachmentUrls: string[]): ContentBlock[] {
  if (attachmentUrls.length === 0) {
    return [{ type: 'text', text }];
  }
  const urlsBlock = attachmentUrls.map((url) => `- ${url}`).join('\n');
  return [
    {
      type: 'text',
      text: `${text}\n\nAttached media URLs (use these with image/video tools):\n${urlsBlock}`,
    },
  ];
}

function clampLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

type MessageRow = {
  id: string;
  chatId: string;
  userId: string;
  agentRunId: string | null;
  role: string;
  status: string;
  content: unknown;
  metadata: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

/**
 * Older checkpoints stored tool_use without AWAITING_APPROVAL. On list,
 * overlay pending tool_approval waitpoints so reopen still shows Approve/Reject.
 */
async function serializeMessagesWithPendingApprovals(messages: MessageRow[]) {
  const runIds = [
    ...new Set(
      messages
        .filter(
          (m) =>
            m.role === 'ASSISTANT' &&
            m.status === 'STREAMING' &&
            Boolean(m.agentRunId),
        )
        .map((m) => m.agentRunId!),
    ),
  ];

  if (runIds.length === 0) {
    return messages.map(serializeMessage);
  }

  const waitpoints = await db.orm.public.Waitpoint.where({
    type: TOOL_APPROVAL_WAITPOINT_TYPE,
    status: 'PENDING',
  })
    .where((w) => w.agentRunId.in(runIds))
    .all();

  const byRunId = new Map<string, Array<{ toolCallId: string; credits?: number }>>();
  for (const wp of waitpoints) {
    const input = (wp.input ?? {}) as Record<string, unknown>;
    const toolCallId =
      typeof input.toolCallId === 'string' ? input.toolCallId : null;
    if (!toolCallId) continue;
    const credits =
      typeof input.credits === 'number' ? input.credits : undefined;
    const list = byRunId.get(wp.agentRunId) ?? [];
    list.push({ toolCallId, credits });
    byRunId.set(wp.agentRunId, list);
  }

  return messages.map((message) => {
    const pending =
      message.agentRunId && message.status === 'STREAMING'
        ? byRunId.get(message.agentRunId)
        : undefined;
    if (!pending?.length) return serializeMessage(message);

    let blocks = parseContentBlocks(message.content);
    for (const p of pending) {
      blocks = markToolUseAwaitingApproval(blocks, {
        id: p.toolCallId,
        credits: p.credits,
      });
    }
    return serializeMessage({ ...message, content: blocks });
  });
}

function serializeMessage(message: MessageRow) {
  return {
    id: message.id,
    chatId: message.chatId,
    userId: message.userId,
    agentRunId: message.agentRunId,
    role: message.role,
    status: message.status,
    content: message.content,
    metadata: message.metadata,
    createdAt: instantToIso(message.createdAt),
    updatedAt: instantToIso(message.updatedAt),
  };
}
