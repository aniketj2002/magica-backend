import { AppError } from '@/lib/errors';
import { openRouterProvider } from './openrouter/adapter';
import { assertAllowedModel } from './policy';
import type { ChatProvider } from './types';

const providers: ChatProvider[] = [openRouterProvider];

/**
 * Resolve a ChatProvider for the given model id.
 * Policy (allowlist) is enforced here so orchestration never sees disallowed models.
 */
export function resolveProvider(modelId: string): ChatProvider {
  assertAllowedModel(modelId);

  const provider = providers.find((p) => p.supports(modelId));
  if (!provider) {
    throw AppError.modelNotAllowed(modelId);
  }
  return provider;
}

/** Register an additional provider adapter (for tests or future backends). */
export function registerProvider(provider: ChatProvider): void {
  const idx = providers.findIndex((p) => p.id === provider.id);
  if (idx >= 0) {
    providers[idx] = provider;
  } else {
    providers.push(provider);
  }
}
