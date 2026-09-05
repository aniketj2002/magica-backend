/** Provider-neutral chat/LLM surface — no OpenAI / OpenRouter shapes. */

export type ProviderRole = 'system' | 'user' | 'assistant' | 'tool';

export type ProviderToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
};

export type ProviderMessage = {
  role: ProviderRole;
  content: string | null;
  toolCallId?: string;
  name?: string;
  toolCalls?: ProviderToolCall[];
};

export type ProviderToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema object for tool parameters. */
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  modelId: string;
  messages: ProviderMessage[];
  tools?: ProviderToolDefinition[];
  temperature?: number;
  maxTokens?: number;
};

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

export type ProviderEvent =
  | { type: 'model-resolved'; model: string }
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; argumentsJson: string }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }
  | { type: 'finish'; reason: FinishReason };

export interface ChatProvider {
  readonly id: string;
  supports(modelId: string): boolean;
  stream(
    req: ChatRequest,
    opts: { signal: AbortSignal },
  ): AsyncIterable<ProviderEvent>;
}
