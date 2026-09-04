import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { ChatService } from '@/services/chat.service';

export const maxDuration = 30;

const createBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional().nullable(),
});

const listQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().positive().max(100).optional()),
  cursor: z.string().min(1).optional(),
});

export const GET = withRoute(
  { query: listQuerySchema },
  async ({ user, query }) => {
    const result = await ChatService.listChats({
      userId: user!.id,
      limit: query.limit,
      cursor: query.cursor,
    });
    return jsonOk(result);
  },
);

export const POST = withRoute(
  { body: createBodySchema },
  async ({ user, body }) => {
    const chat = await ChatService.createChat(user!.id, body.title);
    return jsonOk(chat, { status: 201 });
  },
);
