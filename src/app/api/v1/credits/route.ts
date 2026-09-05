import { withRoute, jsonOk } from '@/lib/http';
import { fromDecimal } from '@/providers/magica/credits';

export const GET = withRoute({}, async ({ user }) => {
  return jsonOk({ balance: fromDecimal(user!.balance) });
});
