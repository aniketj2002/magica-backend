import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatProvider, ProviderEvent } from '@/providers/llm/types';
import { ProviderError } from '@/providers/llm/errors';

const {
  mockRun,
  mockAssistantMessage,
  mockUpdate,
  mockCreate,
  mockFinalize,
  mockRestore,
  mockExecuteTool,
  mockResolveProvider,
  mockToProviderTools,
} = vi.hoisted(() => {
  const mockRun = {
    id: 'run-1',
    chatId: 'chat-1',
    userId: 'user-1',
    messageId: 'msg-user-1',
    status: 'QUEUED',
    modelRequested: 'openrouter/free',
    modelActual: null as string | null,
    turnCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    startedAt: null as unknown,
  };

  const mockAssistantMessage = {
    id: 'msg-asst-1',
    chatId: 'chat-1',
    userId: 'user-1',
    agentRunId: 'run-1',
    role: 'ASSISTANT',
    status: 'STREAMING',
    content: [],
  };

  return {
    mockRun,
    mockAssistantMessage,
    mockUpdate: vi.fn(async () => undefined),
    mockCreate: vi.fn(async () => mockAssistantMessage),
    mockFinalize: vi.fn(async (args: { status: string }) => ({
      agentRunId: 'run-1',
      status: args.status,
      alreadyTerminal: false,
    })),
    mockRestore: vi.fn(async () => ({
      messages: [{ role: 'user' as const, content: 'hi' }],
      raw: [],
      truncated: false,
    })),
    mockExecuteTool: vi.fn(),
    mockResolveProvider: vi.fn(),
    mockToProviderTools: vi.fn(() => []),
  };
});

function chainable(result: unknown) {
  const api: Record<string, unknown> = {};
  api.where = vi.fn(() => api);
  api.orderBy = vi.fn(() => api);
  api.limit = vi.fn(() => api);
  api.first = vi.fn(async () => result);
  api.all = vi.fn(async () => (result == null ? [] : [result]));
  api.update = mockUpdate;
  api.create = mockCreate;
  return api;
}

vi.mock('@/prisma/db', () => ({
  db: {
    orm: {
      public: {
        AgentRun: {
          where: vi.fn(() => ({
            first: vi.fn(async () => mockRun),
            update: mockUpdate,
          })),
        },
        Message: {
          where: vi.fn(() => chainable(null)),
          create: mockCreate,
        },
      },
    },
  },
}));

vi.mock('@/agent/finalize', () => ({
  finalizeAgentRun: mockFinalize,
}));

vi.mock('@/agent/context', () => ({
  restoreContext: mockRestore,
}));

vi.mock('@/agent/prompts', () => ({
  buildSystemPrompt: () => 'system',
}));

vi.mock('@/providers/llm/registry', () => ({
  resolveProvider: mockResolveProvider,
}));

vi.mock('@/tools', () => ({
  toProviderTools: mockToProviderTools,
  executeTool: mockExecuteTool,
}));

import { runAgentLoop } from '@/agent/loop';

function providerFromEvents(
  turns: Array<AsyncIterable<ProviderEvent> | (() => AsyncIterable<ProviderEvent>)>,
): ChatProvider {
  let i = 0;
  return {
    id: 'mock',
    supports: () => true,
    stream: async function* () {
      const turn = turns[i++] ?? turns[turns.length - 1]!;
      const iter = typeof turn === 'function' ? turn() : turn;
      yield* iter;
    },
  };
}

async function* events(
  list: ProviderEvent[],
): AsyncGenerator<ProviderEvent, void, undefined> {
  for (const e of list) yield e;
}

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.status = 'QUEUED';
    mockRun.turnCount = 0;
    mockRun.modelActual = null;
    mockCreate.mockResolvedValue(mockAssistantMessage);
    mockToProviderTools.mockReturnValue([]);
    mockExecuteTool.mockResolvedValue({
      ok: true,
      toolName: 'echo',
      toolCallId: 'call-1',
      invocationId: 'inv-1',
      output: { ok: true },
      estimatedCredits: 0,
    });
  });

  it('runs a multi-turn tool cycle then completes', async () => {
    mockResolveProvider.mockReturnValue(
      providerFromEvents([
        events([
          { type: 'model-resolved', model: 'mock/model' },
          {
            type: 'tool-call',
            id: 'call-1',
            name: 'echo',
            argumentsJson: '{"x":1}',
          },
          { type: 'finish', reason: 'tool_calls' },
        ]),
        events([
          { type: 'text-delta', text: 'done' },
          { type: 'finish', reason: 'stop' },
        ]),
      ]),
    );

    const parts: string[] = [];
    const result = await runAgentLoop({
      agentRunId: 'run-1',
      signal: new AbortController().signal,
      maxTurns: 4,
      emit: async (p) => {
        parts.push(p.type);
      },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.turnCount).toBe(2);
    expect(mockExecuteTool).toHaveBeenCalledOnce();
    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED' }),
    );
    expect(parts).toContain('tool-call');
    expect(parts).toContain('tool-result');
    expect(parts).toContain('finish');
  });

  it('finalizes FAILED on malformed tool arguments from the provider', async () => {
    mockResolveProvider.mockReturnValue({
      id: 'mock',
      supports: () => true,
      stream: async function* (): AsyncGenerator<ProviderEvent, void, undefined> {
        throw new ProviderError(
          'malformed_tool_call',
          'Tool call arguments are not valid JSON',
          { retryable: false },
        );
      },
    } satisfies ChatProvider);

    await expect(
      runAgentLoop({
        agentRunId: 'run-1',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ kind: 'malformed_tool_call' });

    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'malformed_tool_call',
      }),
    );
  });

  it('caps at maxTurns when the model keeps requesting tools', async () => {
    mockResolveProvider.mockReturnValue(
      providerFromEvents([
        () =>
          events([
            {
              type: 'tool-call',
              id: 'call-1',
              name: 'echo',
              argumentsJson: '{}',
            },
            { type: 'finish', reason: 'tool_calls' },
          ]),
      ]),
    );

    const result = await runAgentLoop({
      agentRunId: 'run-1',
      signal: new AbortController().signal,
      maxTurns: 2,
    });

    expect(result.status).toBe('FAILED');
    expect(result.turnCount).toBe(2);
    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'max_turns',
      }),
    );
  });

  it('cancels mid-stream when the signal aborts', async () => {
    const controller = new AbortController();
    mockResolveProvider.mockReturnValue({
      id: 'mock',
      supports: () => true,
      async *stream(_req, opts) {
        yield { type: 'text-delta', text: 'partial' } satisfies ProviderEvent;
        controller.abort();
        if (opts.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
      },
    } satisfies ChatProvider);

    const result = await runAgentLoop({
      agentRunId: 'run-1',
      signal: controller.signal,
    });

    expect(result.status).toBe('CANCELLED');
    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CANCELLED' }),
    );
  });
});
