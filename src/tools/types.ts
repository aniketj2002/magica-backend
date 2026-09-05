import type { z } from 'zod';
import type { Logger } from '@/lib/logger';

export type ToolProgressPart = {
  type: 'tool-progress';
  id: string;
  name: string;
  status: string;
};

export type ToolApprovalRequiredPart = {
  type: 'tool-approval-required';
  id: string;
  name: string;
  /** App credits that will be reserved if the user approves. */
  credits: number;
};

export type ToolEmitPart = ToolProgressPart | ToolApprovalRequiredPart;

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
  /** Optional stream emit (tool-progress / tool-approval-required). */
  emit?: (part: ToolEmitPart) => void | Promise<void>;
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
