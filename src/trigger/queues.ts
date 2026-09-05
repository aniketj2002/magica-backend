import { queue } from '@trigger.dev/sdk';

/**
 * Shared queue for agent runs. At trigger time pass `concurrencyKey: chatId`
 * so Trigger serializes per chat (defence in depth behind Chat.activeRunId).
 */
export const agentRunQueue = queue({
  name: 'agent-run',
  concurrencyLimit: 20,
});

export const AGENT_RUN_TASK_ID = 'agent-run' as const;

/** Options for `tasks.trigger` / `agentRunTask.trigger`. */
export function agentRunTriggerOptions(chatId: string, agentRunId: string) {
  return {
    queue: 'agent-run',
    concurrencyKey: chatId,
    idempotencyKey: agentRunId,
  } as const;
}
