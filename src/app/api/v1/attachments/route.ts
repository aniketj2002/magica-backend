import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { AttachmentService } from '@/services/attachment.service';

export const maxDuration = 30;

const createBodySchema = z.object({
  chatId: z.string().uuid(),
  originalName: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export const POST = withRoute(
  { body: createBodySchema },
  async ({ user, body }) => {
    const result = await AttachmentService.createDirectUpload({
      userId: user!.id,
      chatId: body.chatId,
      originalName: body.originalName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });
    return jsonOk(result, { status: 201 });
  },
);
