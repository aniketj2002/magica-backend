import { z } from 'zod';
import type { ProviderToolDefinition } from '@/providers/llm/types';
import type { ToolDefinition } from './types';

const tools = new Map<string, ToolDefinition>();

/** Register a tool. Replaces an existing registration with the same name. */
export function registerTool<I, O>(tool: ToolDefinition<I, O>): void {
  tools.set(tool.name, tool as ToolDefinition);
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

export function listTools(): ToolDefinition[] {
  return [...tools.values()];
}

/**
 * Convert registered tools to the provider-neutral tool shape.
 * Uses Zod 4's built-in `z.toJSONSchema` (no zod-to-json-schema dependency).
 */
export function toProviderTools(): ProviderToolDefinition[] {
  return listTools().map((tool) => {
    const schema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
    // OpenAI-compatible tools expect a JSON Schema object for `parameters`.
    // Drop meta keys that some providers reject.
    const { $schema: _schema, ...parameters } = schema;
    return {
      name: tool.name,
      description: tool.description,
      parameters: parameters as Record<string, unknown>,
    };
  });
}

/** Test helper — clear the in-memory registry. */
export function clearTools(): void {
  tools.clear();
}
