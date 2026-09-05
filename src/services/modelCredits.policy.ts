/**
 * Model-usage credit policy. OpenRouter (including free) settles at 0 —
 * tokens remain recorded on AgentRun for tracking. A paid model later only
 * needs a policy change, not loop changes.
 */
export function estimateModelCredits(
  _usage: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
  },
  modelId: string | null | undefined,
): number {
  if (!modelId) return 0;
  if (modelId.startsWith('openrouter/')) return 0;
  return 0;
}
