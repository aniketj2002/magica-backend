import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { AttachmentService } from '@/services/attachment.service';

export const maxDuration = 30;

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export const GET = withRoute(
  { params: paramsSchema },
  async ({ user, params }) => {
    const attachment = await AttachmentService.getForUser(params.id, user!.id);
    return jsonOk({ attachment });
  },
);
