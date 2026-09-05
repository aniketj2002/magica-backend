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

  // ASSISTANT
  const text = textFromBlocks(blocks);
  const toolCalls: ProviderToolCall[] = [];
  for (const block of blocks) {
    if (block.type !== 'tool_use') continue;
    toolCalls.push({
      id: block.id,
      name: block.name,
      argumentsJson:
        typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
    });
  }

  if (toolCalls.length === 0 && !text) {
    return [];
  }

  return [
    {
      role: 'assistant',
      content: text || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    },
  ];
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
