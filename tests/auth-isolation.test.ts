import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const { mockFindChat, mockFindRun } = vi.hoisted(() => ({
  mockFindChat: vi.fn(),
  mockFindRun: vi.fn(),
}));

vi.mock('@/repositories/chat.repository', () => ({
  ChatRepository: {
    findByIdForUser: mockFindChat,
    listForUser: vi.fn(),
    create: vi.fn(),
  },
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

import { ChatService } from '@/services/chat.service';
import { AgentRunService } from '@/services/agentRun.service';

describe('auth isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 (not 403) when another user requests a chat', async () => {
    mockFindChat.mockResolvedValue(null);

    await expect(ChatService.getChat('chat-other', 'user-attacker')).rejects.toEqual(
      expect.objectContaining({
        code: 'not_found',
        status: 404,
      } satisfies Partial<AppError>),
    );
  });

  it('returns 404 when another user requests a run', async () => {
    mockFindRun.mockResolvedValue(null);

    await expect(AgentRunService.getRun('run-other', 'user-attacker')).rejects.toEqual(
      expect.objectContaining({
        code: 'not_found',
        status: 404,
      }),
    );
  });

  it('does not leak whether the resource exists via status code', async () => {
    mockFindChat.mockResolvedValue(null);
    mockFindRun.mockResolvedValue(null);

    const chatErr = await ChatService.getChat('missing', 'user-1').catch((e) => e);
    const runErr = await AgentRunService.getRun('missing', 'user-1').catch((e) => e);

    expect(chatErr).toBeInstanceOf(AppError);
    expect(runErr).toBeInstanceOf(AppError);
    expect(chatErr.status).toBe(404);
    expect(runErr.status).toBe(404);
    expect(chatErr.message).toBe(runErr.message);
  });
});
