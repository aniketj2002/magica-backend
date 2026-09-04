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

vi.mock('@/services/creditReservation.service', () => ({
  CreditReservationService: {
    ensureReservation: vi.fn(async () => ({ reservedCredits: 0, topUp: 0 })),
  },
}));

import { runAgentLoop } from '@/agent/loop';
import { InsufficientCreditsError } from '@/lib/credits-errors';
import { CreditReservationService } from '@/services/creditReservation.service';

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

  it('finalizes FAILED with insufficient_credits when a mid-run top-up fails', async () => {
    vi.mocked(CreditReservationService.ensureReservation).mockRejectedValueOnce(
      new InsufficientCreditsError(),
    );

    mockResolveProvider.mockReturnValue(
      providerFromEvents([
        events([
          {
            type: 'usage',
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
          { type: 'text-delta', text: 'hi' },
          { type: 'finish', reason: 'stop' },
        ]),
      ]),
    );

    const parts: Array<{ type: string; code?: string }> = [];
    const result = await runAgentLoop({
      agentRunId: 'run-1',
      signal: new AbortController().signal,
      emit: async (p) => {
        parts.push(p);
      },
    });

    expect(result.status).toBe('FAILED');
    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'insufficient_credits',
      }),
    );
    expect(parts.some((p) => p.type === 'error' && p.code === 'insufficient_credits')).toBe(
      true,
    );
  });

  it('resumes after a waitpoint-backed tool emits WAITING then COMPLETED progress', async () => {
    mockExecuteTool.mockImplementation(async (args: {
      toolCallId: string;
      emit?: (part: { type: string; id: string; name: string; status: string }) => Promise<void>;
    }) => {
      await args.emit?.({
        type: 'tool-progress',
        id: args.toolCallId,
        name: 'crop_image',
        status: 'WAITING',
      });
      await args.emit?.({
        type: 'tool-progress',
        id: args.toolCallId,
        name: 'crop_image',
        status: 'COMPLETED',
      });
      return {
        ok: true,
        toolName: 'crop_image',
        toolCallId: args.toolCallId,
        invocationId: 'inv-wait',
        output: { image_url: ['https://media.test.local/out.png'] },
        estimatedCredits: 1,
      };
    });

    mockResolveProvider.mockReturnValue(
      providerFromEvents([
        events([
          {
            type: 'tool-call',
            id: 'call-wait',
            name: 'crop_image',
            argumentsJson: '{"image_url":"https://example.com/a.png"}',
          },
          { type: 'finish', reason: 'tool_calls' },
        ]),
        events([
          { type: 'text-delta', text: 'cropped' },
          { type: 'finish', reason: 'stop' },
        ]),
      ]),
    );

    const parts: Array<{ type: string; status?: string }> = [];
    const result = await runAgentLoop({
      agentRunId: 'run-1',
      signal: new AbortController().signal,
      maxTurns: 4,
      emit: async (p) => {
        parts.push(p);
      },
    });

    expect(result.status).toBe('COMPLETED');
    expect(mockExecuteTool).toHaveBeenCalledOnce();
    expect(
      parts.filter((p) => p.type === 'tool-progress').map((p) => p.status),
    ).toEqual(['WAITING', 'COMPLETED']);
    expect(parts).toContainEqual(
      expect.objectContaining({ type: 'tool-result', id: 'call-wait', ok: true }),
    );
  });
});
