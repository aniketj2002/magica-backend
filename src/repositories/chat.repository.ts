import type { Temporal } from '@js-temporal/polyfill';
import { db } from '@/prisma/db';
import type { OrmClient } from '@/prisma/orm';
import { now } from '@/lib/temporal';

export type ChatRow = NonNullable<
  Awaited<ReturnType<typeof ChatRepository.findByIdForUser>>
>;

export const ChatRepository = {
  async create(userId: string, title?: string | null) {
    return await db.orm.public.Chat.create({
      userId,
      title: title ?? null,
      updatedAt: now(),
    });
  },

  async findByIdForUser(chatId: string, userId: string) {
    return await db.orm.public.Chat.where({ id: chatId, userId }).first();
  },

  async listForUser(opts: {
    userId: string;
    limit: number;
    cursor?: { createdAt: Temporal.Instant; id: string } | null;
  }) {
    let query = db.orm.public.Chat.where({ userId: opts.userId }).orderBy([
      (c) => c.createdAt.desc(),
      (c) => c.id.desc(),
    ]);

    if (opts.cursor) {
      query = query.cursor({
        createdAt: opts.cursor.createdAt,
        id: opts.cursor.id,
      });
    }

    return await query.limit(opts.limit).all();
  },
};
