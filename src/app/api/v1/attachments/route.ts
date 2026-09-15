import { z } from 'zod';
import { withRoute, jsonOk, jsonError } from '@/lib/http';
import { AttachmentService } from '@/services/attachment.service';
import {
  UPLOAD_MAX_BYTES,
  consume,
  rateLimitExceededError,
  rateLimitHeaders,
} from '@/lib/rate-limit';

export const maxDuration = 30;

const createBodySchema = z.object({
  chatId: z.string().uuid(),
  originalName: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().max(UPLOAD_MAX_BYTES),
});

export const POST = withRoute(
  { body: createBodySchema },
  async ({ user, body }) => {
    const rl = await consume(user!.id, 'upload');
    if (!rl.allowed) {
      return jsonError(rateLimitExceededError(rl), {
        headers: rateLimitHeaders(rl),
      });
    }

    const result = await AttachmentService.createDirectUpload({
      userId: user!.id,
      chatId: body.chatId,
      originalName: body.originalName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });
    return jsonOk(result, {
      status: 201,
      headers: rateLimitHeaders(rl),
    });
  },
);
