import type { JsonValue } from '@prisma/orm-postgres/target/codec-types';
import { db } from '@/prisma/db';
import type { OrmClient } from '@/prisma/orm';
import { now } from '@/lib/temporal';

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

export type AttachmentRow = NonNullable<
  Awaited<ReturnType<typeof AttachmentRepository.findByIdForUser>>
>;

export const AttachmentRepository = {
  async create(
    opts: {
      userId: string;
      chatId: string;
      originalName: string;
      mimeType: string;
      sizeBytes?: number;
    },
    client: OrmClient = db,
  ) {
    return await client.orm.public.Attachment.create({
      userId: opts.userId,
      chatId: opts.chatId,
      originalName: opts.originalName,
      mimeType: opts.mimeType,
      sizeBytes: opts.sizeBytes ?? 0,
      status: 'PENDING',
      updatedAt: now(),
    });
  },

  async findByIdForUser(id: string, userId: string) {
    return await db.orm.public.Attachment.where({ id, userId }).first();
  },

  async findByIdsForUserChat(opts: {
    ids: string[];
    userId: string;
    chatId: string;
  }) {
    if (opts.ids.length === 0) return [];
    return await db.orm.public.Attachment.where({
      userId: opts.userId,
      chatId: opts.chatId,
    })
      .where((a) => a.id.in(opts.ids))
      .all();
  },

  async linkToMessage(
    opts: { ids: string[]; messageId: string },
    client: OrmClient = db,
  ) {
    if (opts.ids.length === 0) return;
    await client.orm.public.Attachment.where((a) => a.id.in(opts.ids)).update({
      messageId: opts.messageId,
      updatedAt: now(),
    });
  },

  async markCompleted(opts: {
    id: string;
    transloaditAssemblyId: string;
    storageProvider: string;
    storageKey: string;
    resultUrl: string;
    sizeBytes: number;
    mimeType?: string;
  }) {
    return await db.orm.public.Attachment.where({ id: opts.id }).update({
      status: 'COMPLETED',
      transloaditAssemblyId: opts.transloaditAssemblyId,
      storageProvider: opts.storageProvider,
      storageKey: opts.storageKey,
      resultUrl: opts.resultUrl,
      sizeBytes: opts.sizeBytes,
      ...(opts.mimeType ? { mimeType: opts.mimeType } : {}),
      updatedAt: now(),
    });
  },

  async markFailed(id: string, metadata?: Record<string, unknown>) {
    return await db.orm.public.Attachment.where({ id }).update({
      status: 'FAILED',
      ...(metadata ? { metadata: asJson(metadata) } : {}),
      updatedAt: now(),
    });
  },
};
