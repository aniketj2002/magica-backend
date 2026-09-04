import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import {
  ToolsPricingService,
  estimateBodySchema,
} from '@/services/toolsPricing.service';

export const maxDuration = 60;

const paramsSchema = z.object({
  name: z.string().min(1).max(128),
});

export const POST = withRoute(
  { params: paramsSchema, body: estimateBodySchema },
  async ({ params, body }) => {
    const result = await ToolsPricingService.estimateTool({
      name: params.name,
      input: body.input,
    });
    return jsonOk(result);
  },
);
