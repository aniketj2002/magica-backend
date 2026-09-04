export type BuildSystemPromptOptions = {
  /** Optional skills catalog text injected into the system prompt. Stub for later. */
  skillsCatalog?: string;
};

const BASE_SYSTEM_PROMPT = `You are Magica, a helpful creative assistant.
Be concise, accurate, and action-oriented.
When tools are available, use them when they clearly improve the answer.
Never invent tool results — only report what tools return.`;

/**
 * Build the system prompt. Skills-catalog injection is stubbed for a later iteration.
 */
export function buildSystemPrompt(opts: BuildSystemPromptOptions = {}): string {
  const parts = [BASE_SYSTEM_PROMPT];

  if (opts.skillsCatalog && opts.skillsCatalog.trim().length > 0) {
    parts.push('', '## Available skills', opts.skillsCatalog.trim());
  }

  return parts.join('\n');
}
