import { db } from '@/prisma/db';
import { MessageRepository } from '@/repositories/message.repository';
import type { ProviderMessage } from '@/providers/llm/types';
import {
  blocksToProviderMessages,
  parseContentBlocks,
  type ContentBlock,
} from './content';

export type ContextMessage = {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  content: ContentBlock[];
};

export type RestoreContextOptions = {
  chatId: string;
  /** Max messages to load (newest-first before reverse). Default 40. */
  messageLimit?: number;
  /** Rough token budget across restored messages. Default 32_000. */
  tokenBudget?: number;
  /** Exclude a message id (e.g. the in-progress assistant row). */
  excludeMessageIds?: string[];
};

export type RestoredContext = {
  messages: ProviderMessage[];
  raw: ContextMessage[];
  truncated: boolean;
};

const DEFAULT_MESSAGE_LIMIT = 40;
const DEFAULT_TOKEN_BUDGET = 32_000;

/**
 * Restore conversation context from Postgres with a bounded query
 * (last N messages, newest-first then reversed) and a token budget.
 */
export async function restoreContext(
  opts: RestoreContextOptions,
): Promise<RestoredContext> {
  const limit = opts.messageLimit ?? DEFAULT_MESSAGE_LIMIT;
  const tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const exclude = new Set(opts.excludeMessageIds ?? []);

  const rows = await MessageRepository.findContextMessages(opts.chatId, {
    limit,
  });

  const chronological = [...rows].reverse().filter((r) => !exclude.has(r.id));

  const raw: ContextMessage[] = chronological.map((row) => ({
    id: row.id,
    role: row.role,
    content: parseContentBlocks(row.content),
  }));

  const selected: ContextMessage[] = [];
  let usedTokens = 0;
  let truncated = chronological.length >= limit;

  // Prefer newest turns under the budget: walk from the end.
  for (let i = raw.length - 1; i >= 0; i--) {
    const msg = raw[i]!;
    const cost = estimateTokens(msg.content);
    if (selected.length > 0 && usedTokens + cost > tokenBudget) {
      truncated = true;
      break;
    }
    selected.push(msg);
    usedTokens += cost;
  }
  selected.reverse();

  const messages: ProviderMessage[] = [];
  for (const msg of selected) {
    messages.push(...blocksToProviderMessages(msg.role, msg.content));
  }

  return { messages, raw: selected, truncated };
}

function estimateTokens(blocks: ContentBlock[]): number {
  let chars = 0;
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'thinking':
        chars += block.text.length;
        break;
      case 'tool_use':
        chars += block.name.length + JSON.stringify(block.input ?? {}).length;
        break;
      case 'tool_result':
        chars +=
          typeof block.content === 'string'
            ? block.content.length
            : JSON.stringify(block.content ?? {}).length;
        break;
      case 'usage':
        break;
    }
  }
  return Math.ceil(chars / 4);
}
