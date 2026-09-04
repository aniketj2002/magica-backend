import { z } from 'zod';
import { withRoute, jsonOk } from '@/lib/http';
import { CreditService } from '@/services/credit.service';

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  show: z.enum(['debited', 'credited', 'all']).optional(),
});

export const GET = withRoute(
  { query: querySchema },
  async ({ user, query }) => {
    const usage = await CreditService.getUsage({
      userId: user!.id,
      from: query.from,
      to: query.to,
      show: query.show,
    });
    return jsonOk(usage);
  },
);
