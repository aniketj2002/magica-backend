import { AppError } from '@/lib/errors';
import { decodeCursor, encodeCursor, instantToIso } from '@/lib/cursor';
import { deriveChatTitle } from '@/lib/chatTitle';
import { ChatRepository } from '@/repositories/chat.repository';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const ChatService = {
  async createChat(userId: string, title?: string | null) {
    const chat = await ChatRepository.create(userId, title);
    return serializeChat(chat);
  },

  async getChat(chatId: string, userId: string) {
    const chat = await ChatRepository.findByIdForUser(chatId, userId);
    if (!chat) throw AppError.notFound();
    return serializeChat(chat);
  },

  async updateChatTitle(chatId: string, userId: string, title: string) {
    const chat = await ChatRepository.findByIdForUser(chatId, userId);
    if (!chat) throw AppError.notFound();
    const next = deriveChatTitle(title);
    const updated = await ChatRepository.updateTitle({
      chatId,
      userId,
      title: next,
    });
    return serializeChat(updated ?? { ...chat, title: next });
  },

  async listChats(opts: {
    userId: string;
    limit?: number;
    cursor?: string | null;
  }) {
    const limit = clampLimit(opts.limit);
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
    const rows = await ChatRepository.listForUser({
      userId: opts.userId,
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
      items: page.map(serializeChat),
      nextCursor,
    };
  },
};

function clampLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

function serializeChat(chat: {
  id: string;
  userId: string;
  title: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}) {
  return {
    id: chat.id,
    userId: chat.userId,
    title: chat.title,
    createdAt: instantToIso(chat.createdAt),
    updatedAt: instantToIso(chat.updatedAt),
  };
}
