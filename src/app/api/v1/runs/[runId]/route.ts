import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { AgentRunService } from '@/services/agentRun.service';

export const maxDuration = 30;

const paramsSchema = z.object({
  runId: z.string().uuid(),
});

export const GET = withRoute(
  { params: paramsSchema },
  async ({ user, params }) => {
    const run = await AgentRunService.getRun(params.runId, user!.id);
    return jsonOk(run);
  },
);
