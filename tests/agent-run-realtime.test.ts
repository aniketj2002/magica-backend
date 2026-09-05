import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const { mockFindRun, mockCreatePublicToken } = vi.hoisted(() => ({
  mockFindRun: vi.fn(),
  mockCreatePublicToken: vi.fn(async () => 'public-token'),
}));

vi.mock('@/repositories/agentRun.repository', () => ({
  AgentRunRepository: {
    findByIdForUser: mockFindRun,
    findById: mockFindRun,
  },
}));

vi.mock('@/agent/finalize', () => ({
  finalizeAgentRun: vi.fn(),
}));

vi.mock('@trigger.dev/sdk', () => ({
  runs: { cancel: vi.fn() },
  auth: { createPublicToken: mockCreatePublicToken },
  streams: {
    define: vi.fn(() => ({ id: 'agent' })),
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/prisma/db', () => ({
  db: {
    orm: {
      public: {
        AgentRun: {
          where: vi.fn(() => ({ update: vi.fn() })),
        },
      },
    },
  },
}));

import { AgentRunService } from '@/services/agentRun.service';

const baseRun = {
  id: '81903535-6816-40bc-9338-b0d943a2dd81',
  chatId: '5638a529-3023-4b14-a8e7-866eb51482c1',
  userId: '5c788aa2-2635-4f05-af57-0e2b2b0c8e67',
  messageId: 'a83426c0-56e0-4bac-a494-538ce8b3c366',
  status: 'RUNNING',
  modelRequested: 'openrouter/free',
  modelActual: null,
  triggerTaskId: 'agent-run',
  triggerRunId: 'run_06g712ss6ohhli34qipg8fn901',
  turnCount: 1,
  errorCode: null,
  errorMessage: null,
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
  startedAt: new Date('2026-09-05T08:00:00.000Z'),
  completedAt: null,
  createdAt: new Date('2026-09-05T08:00:00.000Z'),
  updatedAt: new Date('2026-09-05T08:00:00.000Z'),
};

describe('AgentRunService.getRun realtime token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePublicToken.mockResolvedValue('public-token');
  });

  it('includes realtime token for non-terminal runs with triggerRunId', async () => {
    mockFindRun.mockResolvedValue(baseRun);

    const result = await AgentRunService.getRun(baseRun.id, baseRun.userId);

    expect(mockCreatePublicToken).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: { read: { runs: [baseRun.triggerRunId] } },
      }),
    );
    expect(result.realtime).toEqual({
      runId: baseRun.triggerRunId,
      streamId: 'agent',
      publicAccessToken: 'public-token',
    });
  });

  it('omits realtime for terminal runs', async () => {
    mockFindRun.mockResolvedValue({ ...baseRun, status: 'COMPLETED' });

    const result = await AgentRunService.getRun(baseRun.id, baseRun.userId);

    expect(mockCreatePublicToken).not.toHaveBeenCalled();
    expect(result.realtime).toBeUndefined();
  });

  it('omits realtime when triggerRunId is missing', async () => {
    mockFindRun.mockResolvedValue({ ...baseRun, triggerRunId: null });

    const result = await AgentRunService.getRun(baseRun.id, baseRun.userId);

    expect(mockCreatePublicToken).not.toHaveBeenCalled();
    expect(result.realtime).toBeUndefined();
  });

  it('still 404s for missing runs', async () => {
    mockFindRun.mockResolvedValue(null);
    await expect(
      AgentRunService.getRun(baseRun.id, baseRun.userId),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'not_found',
        status: 404,
      } satisfies Partial<AppError>),
    );
  });
});
