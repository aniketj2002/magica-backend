import { withRoute, jsonOk } from '@/lib/http';

export const GET = withRoute({}, async ({ user }) => {
  return jsonOk({ balance: user!.balance });
});
