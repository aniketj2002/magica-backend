import { AppError } from '@/lib/errors';

/** Only free-tier models are allowed — no paid fallback. */
export const ALLOWED_MODELS = ['openrouter/free'] as const;

export type AllowedModelId = (typeof ALLOWED_MODELS)[number];

const allowedSet = new Set<string>(ALLOWED_MODELS);

export function isAllowedModel(modelId: string): modelId is AllowedModelId {
  return allowedSet.has(modelId);
}

/** Reject disallowed models at the API boundary with 422. */
export function assertAllowedModel(modelId: string): asserts modelId is AllowedModelId {
  if (!isAllowedModel(modelId)) {
    throw AppError.modelNotAllowed(modelId);
  }
}
