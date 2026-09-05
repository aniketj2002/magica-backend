import { streams } from '@trigger.dev/sdk';
import type { AgentStreamPart } from '@/agent';

export type { AgentStreamPart };

/** Realtime stream for agent loop parts (`useRealtimeStream`). */
export const agentStream = streams.define<AgentStreamPart>({
  id: 'agent',
});
