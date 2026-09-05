import { z } from 'zod';
import type { ProviderMessage, ProviderToolCall } from '@/providers/llm/types';

export const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const thinkingBlockSchema = z.object({
  type: z.literal('thinking'),
  text: z.string(),
});

export const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

export const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string(),
  content: z.unknown(),
  isError: z.boolean().optional(),
});

export const usageBlockSchema = z.object({
  type: z.literal('usage'),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const contentBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  thinkingBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
  usageBlockSchema,
]);

export const contentBlocksSchema = z.array(contentBlockSchema);

export type TextBlock = z.infer<typeof textBlockSchema>;
export type ThinkingBlock = z.infer<typeof thinkingBlockSchema>;
export type ToolUseBlock = z.infer<typeof toolUseBlockSchema>;
export type ToolResultBlock = z.infer<typeof toolResultBlockSchema>;
export type UsageBlock = z.infer<typeof usageBlockSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export function parseContentBlocks(raw: unknown): ContentBlock[] {
  const parsed = contentBlocksSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Tolerate a bare string stored as content.
  if (typeof raw === 'string') {
    return raw.length > 0 ? [{ type: 'text', text: raw }] : [];
  }
  return [];
}

export function textFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Map durable DB content blocks → provider messages for one row. */
export function blocksToProviderMessages(
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL',
  blocks: ContentBlock[],
): ProviderMessage[] {
  if (role === 'SYSTEM') {
    const text = textFromBlocks(blocks);
    return text ? [{ role: 'system', content: text }] : [];
  }

  if (role === 'USER') {
    const text = textFromBlocks(blocks);
    return [{ role: 'user', content: text || null }];
  }

  if (role === 'TOOL') {
    const messages: ProviderMessage[] = [];
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue;
      messages.push({
        role: 'tool',
        content: stringifyToolResult(block.content),
        toolCallId: block.toolUseId,
      });
    }
    return messages;
  }

  return assistantBlocksToProviderMessages(blocks);
}

/**
 * One assistant step: what the model said, what it called, and what came back.
 * A step ends once its tool results arrive; later blocks open the next step.
 */
type AssistantStep = {
  text: string;
  toolCalls: ProviderToolCall[];
  toolResults: ToolResultBlock[];
};

function emptyStep(): AssistantStep {
  return { text: '', toolCalls: [], toolResults: [] };
}

function isEmptyStep(step: AssistantStep): boolean {
  return (
    step.text === '' &&
    step.toolCalls.length === 0 &&
    step.toolResults.length === 0
  );
}

function toProviderToolCall(block: ToolUseBlock): ProviderToolCall {
  return {
    id: block.id,
    name: block.name,
    argumentsJson:
      typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
  };
}

/** Group a flat block list into ordered assistant steps. */
function toAssistantSteps(blocks: ContentBlock[]): AssistantStep[] {
  const steps: AssistantStep[] = [];
  let step = emptyStep();

  /** Anything after a tool result belongs to the following step. */
  const startNextStepIfResultsSeen = () => {
    if (step.toolResults.length === 0) return;
    steps.push(step);
    step = emptyStep();
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        startNextStepIfResultsSeen();
        step.text += block.text;
        break;
      case 'tool_use':
        startNextStepIfResultsSeen();
        step.toolCalls.push(toProviderToolCall(block));
        break;
      case 'tool_result':
        step.toolResults.push(block);
        break;
      case 'thinking':
      case 'usage':
        // Never replayed to the provider.
        break;
    }
  }

  if (!isEmptyStep(step)) steps.push(step);
  return steps;
}

/**
 * Map assistant content blocks → provider messages.
 *
 * Blocks are stored flat (text, tool_use, tool_result, …) but providers require
 * every assistant message carrying `tool_calls` to be followed by one tool
 * message per call, so each step becomes an assistant message plus its replies.
 */
export function assistantBlocksToProviderMessages(
  blocks: ContentBlock[],
): ProviderMessage[] {
  return toAssistantSteps(blocks).flatMap((step) => {
    const messages: ProviderMessage[] = [];

    if (step.text || step.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: step.text || null,
        toolCalls: step.toolCalls.length > 0 ? step.toolCalls : undefined,
      });
    }

    for (const result of step.toolResults) {
      messages.push({
        role: 'tool',
        toolCallId: result.toolUseId,
        content: stringifyToolResult(result.content),
      });
    }

    return messages;
  });
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function mergeTextDelta(blocks: ContentBlock[], delta: string): ContentBlock[] {
  const next = [...blocks];
  const last = next[next.length - 1];
  if (last?.type === 'text') {
    next[next.length - 1] = { type: 'text', text: last.text + delta };
  } else {
    next.push({ type: 'text', text: delta });
  }
  return next;
}

export function mergeThinkingDelta(blocks: ContentBlock[], delta: string): ContentBlock[] {
  const next = [...blocks];
  const last = next[next.length - 1];
  if (last?.type === 'thinking') {
    next[next.length - 1] = { type: 'thinking', text: last.text + delta };
  } else {
    next.push({ type: 'thinking', text: delta });
  }
  return next;
}

export function appendToolUse(
  blocks: ContentBlock[],
  tool: { id: string; name: string; argumentsJson: string },
): ContentBlock[] {
  let input: unknown = {};
  try {
    input = tool.argumentsJson.trim() === '' ? {} : JSON.parse(tool.argumentsJson);
  } catch {
    input = { _raw: tool.argumentsJson };
  }
  return [
    ...blocks,
    {
      type: 'tool_use',
      id: tool.id,
      name: tool.name,
      input,
    },
  ];
}

export function appendToolResult(
  blocks: ContentBlock[],
  result: { toolUseId: string; content: unknown; isError?: boolean },
): ContentBlock[] {
  return [
    ...blocks,
    {
      type: 'tool_result',
      toolUseId: result.toolUseId,
      content: result.content,
      isError: result.isError,
    },
  ];
}

/**
 * Append error tool_result blocks for any tool_use that has no matching result.
 * Keeps FE from treating cancelled/failed runs as still "Generating…".
 */
export function closeOpenToolUses(
  blocks: ContentBlock[],
  result: { content: unknown; isError?: boolean },
): ContentBlock[] {
  const closed = new Set(
    blocks
      .filter((b): b is ToolResultBlock => b.type === 'tool_result')
      .map((b) => b.toolUseId),
  );
  const extras: ContentBlock[] = [];
  for (const block of blocks) {
    if (block.type !== 'tool_use' || closed.has(block.id)) continue;
    extras.push({
      type: 'tool_result',
      toolUseId: block.id,
      content: result.content,
      isError: result.isError ?? true,
    });
    closed.add(block.id);
  }
  return extras.length === 0 ? blocks : [...blocks, ...extras];
}

export function upsertUsage(
  blocks: ContentBlock[],
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
): ContentBlock[] {
  const without = blocks.filter((b) => b.type !== 'usage');
  return [
    ...without,
    {
      type: 'usage',
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    },
  ];
}
