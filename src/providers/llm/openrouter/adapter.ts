import { env } from '@/lib/env';
import { ProviderError } from '../errors';
import type {
  ChatProvider,
  ChatRequest,
  FinishReason,
  ProviderEvent,
  ProviderMessage,
  ProviderToolDefinition,
} from '../types';
import { parseSseJsonStream, SseParseError } from './sse';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

type ToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

type OpenRouterChunk = {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    code?: number | string;
  };
};

export class OpenRouterProvider implements ChatProvider {
  readonly id = 'openrouter';

  supports(modelId: string): boolean {
    return modelId.startsWith('openrouter/');
  }

  async *stream(
    req: ChatRequest,
    opts: { signal: AbortSignal },
  ): AsyncIterable<ProviderEvent> {
    const apiKey = env.requireOpenRouterApiKey();

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://magica.app',
          'X-Title': 'Magica',
        },
        body: JSON.stringify(toOpenRouterBody(req)),
        signal: opts.signal,
      });
    } catch (cause) {
      if (opts.signal.aborted) {
        throw cause;
      }
      throw new ProviderError('unavailable', 'OpenRouter request failed', {
        retryable: true,
        cause,
      });
    }

    if (!response.ok) {
      throw await mapHttpError(response);
    }

    if (!response.body) {
      throw new ProviderError('empty_stream', 'OpenRouter returned an empty body', {
        retryable: false,
      });
    }

    const toolCalls = new Map<number, ToolCallAccumulator>();
    let sawModel = false;
    let sawTextOrTool = false;
    let finishReason: FinishReason | null = null;

    try {
      for await (const raw of parseSseJsonStream(response.body)) {
        const chunk = raw as OpenRouterChunk;

        if (chunk.error) {
          throw new ProviderError(
            'unknown',
            chunk.error.message ?? 'OpenRouter stream error',
            { retryable: false, status: Number(chunk.error.code) || undefined },
          );
        }

        if (chunk.model && !sawModel) {
          sawModel = true;
          yield { type: 'model-resolved', model: chunk.model };
        }

        if (chunk.usage) {
          const promptTokens = chunk.usage.prompt_tokens ?? 0;
          const completionTokens = chunk.usage.completion_tokens ?? 0;
          const totalTokens =
            chunk.usage.total_tokens ?? promptTokens + completionTokens;
          yield {
            type: 'usage',
            promptTokens,
            completionTokens,
            totalTokens,
          };
          // Usage chunk repeats finish_reason — do not treat as a second terminal.
          continue;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          sawTextOrTool = true;
          yield { type: 'text-delta', text: delta.content };
        }

        const reasoning = delta?.reasoning ?? delta?.reasoning_content;
        if (reasoning) {
          sawTextOrTool = true;
          yield { type: 'reasoning-delta', text: reasoning };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            const existing = toolCalls.get(index) ?? {
              id: '',
              name: '',
              argumentsJson: '',
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) {
              existing.argumentsJson += tc.function.arguments;
            }
            toolCalls.set(index, existing);
            sawTextOrTool = true;
          }
        }

        if (choice.finish_reason) {
          finishReason = mapFinishReason(choice.finish_reason);
        }
      }
    } catch (cause) {
      if (cause instanceof ProviderError) throw cause;
      if (cause instanceof SseParseError) {
        throw new ProviderError('unknown', cause.message, {
          retryable: false,
          cause,
        });
      }
      if (opts.signal.aborted) throw cause;
      throw new ProviderError('unavailable', 'OpenRouter stream interrupted', {
        retryable: true,
        cause,
      });
    }

    if (!sawTextOrTool && toolCalls.size === 0) {
      throw new ProviderError('empty_stream', 'OpenRouter stream produced no content', {
        retryable: false,
      });
    }

    if (toolCalls.size > 0) {
      const ordered = [...toolCalls.entries()].sort(([a], [b]) => a - b);
      for (const [, tc] of ordered) {
        if (!tc.id || !tc.name) {
          throw new ProviderError(
            'malformed_tool_call',
            'Tool call missing id or name',
            { retryable: false },
          );
        }
        // Validate arguments are JSON (or empty object).
        const args = tc.argumentsJson.length > 0 ? tc.argumentsJson : '{}';
        try {
          JSON.parse(args);
        } catch (cause) {
          throw new ProviderError(
            'malformed_tool_call',
            `Tool call arguments are not valid JSON for ${tc.name}`,
            { retryable: false, cause },
          );
        }
        yield {
          type: 'tool-call',
          id: tc.id,
          name: tc.name,
          argumentsJson: args,
        };
      }
      if (!finishReason) finishReason = 'tool_calls';
    }

    yield { type: 'finish', reason: finishReason ?? 'stop' };
  }
}

function toOpenRouterBody(req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.modelId,
    messages: req.messages.map(toOpenRouterMessage),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map(toOpenRouterTool);
  }
  return body;
}

function toOpenRouterMessage(message: ProviderMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content ?? '',
      ...(message.name ? { name: message.name } : {}),
    };
  }

  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: tc.argumentsJson,
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toOpenRouterTool(tool: ProviderToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return reason;
    case 'function_call':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

async function mapHttpError(response: Response): Promise<ProviderError> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    // ignore
  }

  const status = response.status;
  if (status === 401 || status === 403) {
    return new ProviderError('auth', `OpenRouter auth failed (${status}): ${detail}`, {
      retryable: false,
      status,
    });
  }
  if (status === 429) {
    return new ProviderError('rate_limit', `OpenRouter rate limited: ${detail}`, {
      retryable: true,
      status,
    });
  }
  if (status === 408 || status === 504) {
    return new ProviderError('timeout', `OpenRouter timeout (${status}): ${detail}`, {
      retryable: true,
      status,
    });
  }
  if (status >= 500) {
    return new ProviderError('unavailable', `OpenRouter unavailable (${status}): ${detail}`, {
      retryable: true,
      status,
    });
  }
  if (status >= 400) {
    return new ProviderError(
      'invalid_request',
      `OpenRouter rejected request (${status}): ${detail}`,
      { retryable: false, status },
    );
  }
  return new ProviderError('unknown', `OpenRouter error (${status}): ${detail}`, {
    retryable: false,
    status,
  });
}

export const openRouterProvider = new OpenRouterProvider();
