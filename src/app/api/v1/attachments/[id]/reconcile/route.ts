import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { AttachmentService } from '@/services/attachment.service';

export const maxDuration = 30;

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const bodySchema = z.object({
  assemblyUrl: z.string().url().max(2048),
});

export const POST = withRoute(
  { params: paramsSchema, body: bodySchema },
  async ({ user, params, body }) => {
    const attachment = await AttachmentService.reconcile({
      id: params.id,
      userId: user!.id,
      assemblyUrl: body.assemblyUrl,
    });
    return jsonOk({ attachment });
  },
);
