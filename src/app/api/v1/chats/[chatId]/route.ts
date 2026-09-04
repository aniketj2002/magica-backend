import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { ChatService } from '@/services/chat.service';

export const maxDuration = 30;

const paramsSchema = z.object({
  chatId: z.string().uuid(),
});

export const GET = withRoute(
  { params: paramsSchema },
  async ({ user, params }) => {
    const chat = await ChatService.getChat(params.chatId, user!.id);
    return jsonOk(chat);
  },
);
