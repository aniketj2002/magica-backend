import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { completeToolApproval } from '@/tools/approval';

export const maxDuration = 30;

const paramsSchema = z.object({
  runId: z.string().uuid(),
  toolCallId: z.string().min(1),
});

export const POST = withRoute(
  { params: paramsSchema },
  async ({ user, params }) => {
    const result = await completeToolApproval({
      userId: user!.id,
      runId: params.runId,
      toolCallId: params.toolCallId,
      approved: false,
    });
    return jsonOk(result);
  },
);
