import { magicaJson } from './client';
import {
  MagicaCatalogSchema,
  MagicaCreditBalanceSchema,
  MagicaEstimateCreditsResponseSchema,
  MagicaModelPricingSchema,
  type MagicaCatalog,
  type MagicaCreditBalance,
  type MagicaEstimateNode,
  type MagicaModelPricing,
} from './types';

const CATALOG_TTL_MS = 60 * 60 * 1000;
const PRICING_TTL_MS = 15 * 60 * 1000;

type CatalogCache = {
  value: MagicaCatalog;
  expiresAt: number;
};

type PricingCacheEntry = {
  value: MagicaModelPricing;
  expiresAt: number;
};

let catalogCache: CatalogCache | null = null;
const pricingCache = new Map<string, PricingCacheEntry>();

export async function estimateCredits(
  nodes: MagicaEstimateNode[],
): Promise<{ microcredits: number; estimates: Array<{ microcredits: number }> }> {
  const parsed = await magicaJson(
    '/v1/nodes/estimate-credits',
    { method: 'POST', body: { nodes } },
    (data) => MagicaEstimateCreditsResponseSchema.parse(data),
  );

  const microcredits = parsed.estimates.reduce((sum, e) => sum + e.microcredits, 0);
  return { microcredits, estimates: parsed.estimates };
}

export async function getModelPricing(
  modelId: string,
  sampleInput?: Record<string, unknown>,
  opts?: { forceRefresh?: boolean },
): Promise<MagicaModelPricing> {
  const cacheKey =
    sampleInput === undefined
      ? modelId
      : `${modelId}:${JSON.stringify(sampleInput)}`;
  const now = Date.now();
  if (!opts?.forceRefresh) {
    const hit = pricingCache.get(cacheKey);
    if (hit && hit.expiresAt > now) return hit.value;
  }

  const params = new URLSearchParams();
  if (sampleInput !== undefined) {
    params.set('sampleInput', JSON.stringify(sampleInput));
  }
  const qs = params.toString();
  const path = `/v1/models/${encodeURIComponent(modelId)}/pricing${qs ? `?${qs}` : ''}`;

  const pricing = await magicaJson(path, {}, (data) =>
    MagicaModelPricingSchema.parse(data),
  );
  pricingCache.set(cacheKey, { value: pricing, expiresAt: now + PRICING_TTL_MS });
  return pricing;
}

export async function getCatalog(opts?: {
  forceRefresh?: boolean;
}): Promise<MagicaCatalog> {
  const now = Date.now();
  if (
    !opts?.forceRefresh &&
    catalogCache &&
    catalogCache.expiresAt > now
  ) {
    return catalogCache.value;
  }

  const catalog = await magicaJson(
    '/v1/models/catalog',
    { auth: false },
    (data) => MagicaCatalogSchema.parse(data),
  );

  catalogCache = { value: catalog, expiresAt: now + CATALOG_TTL_MS };
  return catalog;
}

/** Test helper — clears the in-process catalog TTL cache. */
export function clearCatalogCache(): void {
  catalogCache = null;
  pricingCache.clear();
}

export async function getCreditBalance(): Promise<MagicaCreditBalance> {
  return magicaJson('/v1/credits/balance', {}, (data) =>
    MagicaCreditBalanceSchema.parse(data),
  );
}
