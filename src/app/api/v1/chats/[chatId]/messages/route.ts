import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { ChatMessageService } from '@/services/chatMessage.service';

export const maxDuration = 60;

const paramsSchema = z.object({
  chatId: z.string().uuid(),
});

const listQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().positive().max(100).optional()),
  cursor: z.string().min(1).optional(),
});

const sendBodySchema = z.object({
  text: z.string().min(1).max(100_000),
  modelId: z.string().min(1).optional(),
  attachmentIds: z.array(z.string().uuid()).max(20).optional(),
});

export const GET = withRoute(
  { params: paramsSchema, query: listQuerySchema },
  async ({ user, params, query }) => {
    const result = await ChatMessageService.listMessages({
      chatId: params.chatId,
      userId: user!.id,
      limit: query.limit,
      cursor: query.cursor,
    });
    return jsonOk(result);
  },
);

export const POST = withRoute(
  { params: paramsSchema, body: sendBodySchema },
  async ({ request, user, params, body }) => {
    const idempotencyKey = request.headers.get('Idempotency-Key');
    const result = await ChatMessageService.sendMessage({
      chatId: params.chatId,
      userId: user!.id,
      text: body.text,
      modelId: body.modelId,
      idempotencyKey,
      attachmentIds: body.attachmentIds,
    });
    return jsonOk(result, { status: 201 });
  },
);
