import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { InsufficientCreditsError } from '@/lib/credits-errors';

const {
  mockEnsureReservation,
  mockInvocationCreate,
  mockInvocationUpdate,
  mockInvocationFirst,
  mockRequestApproval,
  mockUpdateState,
} = vi.hoisted(() => ({
  mockEnsureReservation: vi.fn(async () => ({ reservedCredits: 5, topUp: 5 })),
  mockInvocationCreate: vi.fn(async () => ({ id: 'inv-1' })),
  mockInvocationUpdate: vi.fn(async () => undefined),
  mockInvocationFirst: vi.fn(async () => null),
  mockRequestApproval: vi.fn(
    async (): Promise<'approved' | 'rejected' | 'timed_out'> => 'approved',
  ),
  mockUpdateState: vi.fn(async () => undefined),
}));

vi.mock('@trigger.dev/sdk', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/creditReservation.service', () => ({
  CreditReservationService: { ensureReservation: mockEnsureReservation },
}));

vi.mock('@/tools/approval', () => ({
  requestToolApproval: mockRequestApproval,
}));

vi.mock('@/repositories/agentRun.repository', () => ({
  AgentRunRepository: { updateState: mockUpdateState },
}));

vi.mock('@/prisma/db', () => ({
  db: {
    orm: {
      public: {
        ToolInvocation: {
          create: mockInvocationCreate,
          where: vi.fn(() => ({
            first: mockInvocationFirst,
            update: mockInvocationUpdate,
          })),
        },
      },
    },
  },
}));

import { executeTool } from '@/tools/execute';
import { clearTools, registerTool } from '@/tools/registry';

const mockExecute = vi.fn(async () => ({ ok: true }));

function registerFakeTool(credits: number) {
  registerTool({
    name: 'fake_tool',
    description: 'test tool',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    pricing: { provider: 'magica', nodeType: 'fake', modelId: 'fake' },
    estimateCost: async () => ({ microcredits: credits * 1_000_000, credits }),
    execute: mockExecute,
  });
}

function args() {
  return {
    toolName: 'fake_tool',
    argumentsJson: '{}',
    toolCallId: 'call-1',
    agentRunId: 'run-1',
    chatId: 'chat-1',
    messageId: 'msg-1',
    userId: 'user-1',
    signal: new AbortController().signal,
  };
}

describe('executeTool credit admission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTools();
    mockInvocationCreate.mockResolvedValue({ id: 'inv-1' });
    mockEnsureReservation.mockResolvedValue({ reservedCredits: 5, topUp: 5 });
    mockRequestApproval.mockResolvedValue('approved');
  });

  it('skips approval for free tools and never holds credits', async () => {
    registerFakeTool(0);
    const result = await executeTool(args());

    expect(mockRequestApproval).not.toHaveBeenCalled();
    expect(mockEnsureReservation).toHaveBeenCalledWith({
      userId: 'user-1',
      agentRunId: 'run-1',
      needed: 0,
    });
    expect(mockExecute).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, estimatedCredits: 0 });
  });

  it('asks for approval before reserving paid tool credits', async () => {
    registerFakeTool(5);
    const result = await executeTool(args());

    expect(mockRequestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'call-1',
        credits: 5,
        toolName: 'fake_tool',
      }),
    );
    expect(mockEnsureReservation).toHaveBeenCalledWith({
      userId: 'user-1',
      agentRunId: 'run-1',
      needed: 5,
    });
    // Approval must happen before reservation.
    expect(mockRequestApproval.mock.invocationCallOrder[0]!).toBeLessThan(
      mockEnsureReservation.mock.invocationCallOrder[0]!,
    );
    expect(mockExecute).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, estimatedCredits: 5 });
  });

  it('never reserves or runs when the user rejects', async () => {
    registerFakeTool(5);
    mockRequestApproval.mockResolvedValueOnce('rejected');

    const result = await executeTool(args());

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'approval_rejected',
    });
    expect(mockEnsureReservation).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('never runs the tool when the post-approval reservation fails', async () => {
    registerFakeTool(5);
    mockEnsureReservation.mockRejectedValueOnce(new InsufficientCreditsError());

    await expect(executeTool(args())).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );

    expect(mockRequestApproval).toHaveBeenCalledOnce();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
