import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const {
  mockFindIdempotency,
  mockClaim,
  mockCreateMessage,
  mockCreateRun,
  mockReserve,
  mockFindChat,
  mockSetTrigger,
  mockTrigger,
  mockCreateToken,
} = vi.hoisted(() => ({
  mockFindIdempotency: vi.fn(),
  mockClaim: vi.fn(),
  mockCreateMessage: vi.fn(),
  mockCreateRun: vi.fn(),
  mockReserve: vi.fn(),
  mockFindChat: vi.fn(),
  mockSetTrigger: vi.fn(),
  mockTrigger: vi.fn(),
  mockCreateToken: vi.fn(),
}));

vi.mock('@/repositories/agentRun.repository', () => ({
  AgentRunRepository: {
    findByIdempotencyKey: mockFindIdempotency,
    create: mockCreateRun,
    setTriggerRunId: mockSetTrigger,
  },
}));

vi.mock('@/repositories/chat.repository', () => ({
  ChatRepository: {
    findByIdForUser: mockFindChat,
    claimActiveRun: mockClaim,
  },
}));

vi.mock('@/repositories/message.repository', () => ({
  MessageRepository: {
    createUserMessage: mockCreateMessage,
  },
}));

vi.mock('@/repositories/creditLedger.repository', () => ({
  CreditLedgerRepository: {
    reserveForRun: mockReserve,
  },
  DEFAULT_RUN_CREDIT_RESERVATION: 1,
}));

vi.mock('@/trigger/streams', () => ({
  agentStream: { id: 'agent' },
}));

vi.mock('@/trigger/queues', () => ({
  AGENT_RUN_TASK_ID: 'agent-run',
  agentRunTriggerOptions: (chatId: string, agentRunId: string) => ({
    queue: 'agent-run',
    concurrencyKey: chatId,
    idempotencyKey: agentRunId,
  }),
}));

vi.mock('@trigger.dev/sdk', () => ({
  tasks: { trigger: mockTrigger },
  auth: { createPublicToken: mockCreateToken },
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
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        orm: {
          public: {
            Chat: {
              where: vi.fn(() => ({
                first: mockFindChat,
              })),
            },
          },
        },
      }),
    ),
    orm: {
      public: {
        Chat: {
          where: vi.fn(() => ({
            first: mockFindChat,
          })),
        },
      },
    },
  },
}));

import { ChatMessageService } from '@/services/chatMessage.service';

describe('ChatMessageService concurrency + idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindChat.mockResolvedValue({
      id: 'chat-1',
      userId: 'user-1',
      activeRunId: null,
    });
    mockCreateMessage.mockResolvedValue({ id: 'msg-1' });
    mockCreateRun.mockResolvedValue({ id: 'run-1' });
    mockReserve.mockResolvedValue({ id: 'ledger-1' });
    mockTrigger.mockResolvedValue({ id: 'triggerrun_1' });
    mockCreateToken.mockResolvedValue('public-token');
    mockSetTrigger.mockResolvedValue(undefined);
    mockFindIdempotency.mockResolvedValue(null);
    mockClaim.mockResolvedValue(1);
  });

  it('rejects a second concurrent send when the chat lock is held', async () => {
    mockClaim.mockResolvedValue(0);

    await expect(
      ChatMessageService.sendMessage({
        chatId: 'chat-1',
        userId: 'user-1',
        text: 'hello',
      }),
    ).rejects.toMatchObject({
      code: 'chat_run_active',
      status: 409,
    } satisfies Partial<AppError>);

    expect(mockTrigger).not.toHaveBeenCalled();
  });

  it('returns the first run for a repeated Idempotency-Key', async () => {
    mockFindIdempotency.mockResolvedValue({
      id: 'run-existing',
      chatId: 'chat-1',
      userId: 'user-1',
      messageId: 'msg-existing',
      triggerRunId: 'triggerrun_existing',
    });

    const result = await ChatMessageService.sendMessage({
      chatId: 'chat-1',
      userId: 'user-1',
      text: 'hello again',
      idempotencyKey: 'idem-1',
    });

    expect(result).toEqual({
      chatId: 'chat-1',
      messageId: 'msg-existing',
      runId: 'run-existing',
      realtime: {
        runId: 'triggerrun_existing',
        streamId: 'agent',
        publicAccessToken: 'public-token',
      },
    });
    expect(mockCreateRun).not.toHaveBeenCalled();
    expect(mockTrigger).not.toHaveBeenCalled();
    expect(mockCreateToken).toHaveBeenCalledOnce();
  });

  it('creates exactly one run on the happy path', async () => {
    const result = await ChatMessageService.sendMessage({
      chatId: 'chat-1',
      userId: 'user-1',
      text: 'hello',
      idempotencyKey: 'idem-2',
    });

    expect(mockCreateRun).toHaveBeenCalledOnce();
    expect(mockClaim).toHaveBeenCalledOnce();
    expect(mockTrigger).toHaveBeenCalledOnce();
    expect(result.runId).toBe('run-1');
    expect(result.realtime.publicAccessToken).toBe('public-token');
  });
});
