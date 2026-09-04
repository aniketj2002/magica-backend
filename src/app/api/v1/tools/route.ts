import { withRoute, jsonOk } from '@/lib/http';
import { ToolsPricingService } from '@/services/toolsPricing.service';

export const maxDuration = 60;

export const GET = withRoute({}, async () => {
  const result = await ToolsPricingService.listToolsWithPricing();
  return jsonOk(result);
});
