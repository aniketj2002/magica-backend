import type { z } from 'zod';
import type { Logger } from '@/lib/logger';

export type ToolProgressPart = {
  type: 'tool-progress';
  id: string;
  name: string;
  status: string;
};

export type ToolContext = {
  agentRunId: string;
  chatId: string;
  messageId: string;
  userId: string;
  signal: AbortSignal;
  logger: Logger;
  /** Provider tool-call id; used as ToolInvocation.idempotencyKey. */
  toolCallId: string;
  /** Persisted ToolInvocation row for this call. */
  toolInvocationId: string;
  /** Optional stream emit (e.g. tool-progress while waiting on Magica). */
  emit?: (part: ToolProgressPart) => void | Promise<void>;
};

export type ToolPricing = {
  provider: 'magica';
  nodeType: string;
  modelId: string;
};

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  /** Microcredits + app credits, resolved against the real pricing engine. */
  estimateCost(input: I): Promise<{ microcredits: number; credits: number }>;
  pricing: ToolPricing;
  execute(input: I, ctx: ToolContext): Promise<O>;
}
