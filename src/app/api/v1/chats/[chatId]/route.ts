import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { ChatService } from '@/services/chat.service';

export const maxDuration = 30;

const paramsSchema = z.object({
  chatId: z.string().uuid(),
});

const patchBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export const GET = withRoute(
  { params: paramsSchema },
  async ({ user, params }) => {
    const chat = await ChatService.getChat(params.chatId, user!.id);
    return jsonOk(chat);
  },
);

export const PATCH = withRoute(
  { params: paramsSchema, body: patchBodySchema },
  async ({ user, params, body }) => {
    const chat = await ChatService.updateChatTitle(
      params.chatId,
      user!.id,
      body.title,
    );
    return jsonOk(chat);
  },
);
