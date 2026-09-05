import type { JsonValue } from '@prisma/orm-postgres/target/codec-types';
import { db } from '@/prisma/db';
import type { OrmClient } from '@/prisma/orm';

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

export const GeneratedAssetRepository = {
  async create(
    opts: {
      userId: string;
      chatId: string;
      messageId?: string | null;
      toolInvocationId?: string | null;
      type: 'IMAGE' | 'VIDEO' | 'AUDIO';
      sourceUrl?: string | null;
      storageProvider?: string | null;
      storageKey?: string | null;
      mimeType?: string | null;
      sizeBytes?: number | null;
      metadata?: Record<string, unknown> | null;
    },
    client: OrmClient = db,
  ) {
    return await client.orm.public.GeneratedAsset.create({
      userId: opts.userId,
      chatId: opts.chatId,
      messageId: opts.messageId ?? null,
      toolInvocationId: opts.toolInvocationId ?? null,
      type: opts.type,
      sourceUrl: opts.sourceUrl ?? null,
      storageProvider: opts.storageProvider ?? null,
      storageKey: opts.storageKey ?? null,
      mimeType: opts.mimeType ?? null,
      sizeBytes: opts.sizeBytes ?? null,
      metadata: opts.metadata ? asJson(opts.metadata) : null,
    });
  },
};
