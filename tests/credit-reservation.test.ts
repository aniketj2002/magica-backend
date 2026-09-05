import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlQueryError } from '@prisma/orm-family-sql/errors';
import { InsufficientCreditsError } from '@/lib/credits-errors';

const {
  mockTryDebit,
  mockAdjustBalance,
  mockRun,
  mockInvocation,
  mockLedgerCreate,
  mockLedgerAll,
  mockExecute,
  mockTransaction,
  mockCreateRelease,
} = vi.hoisted(() => {
  const mockRun = {
    id: 'run-1',
    userId: 'user-1',
    reservedCredits: 0,
    settledCredits: 0,
    status: 'COMPLETED',
  };
  const mockInvocation = {
    id: 'inv-1',
    agentRunId: 'run-1',
  };
  return {
    mockTryDebit: vi.fn(),
    mockAdjustBalance: vi.fn(async () => undefined),
    mockRun,
    mockInvocation,
    mockLedgerCreate: vi.fn(),
    mockLedgerAll: vi.fn(async () => [] as unknown[]),
    mockExecute: vi.fn(async () => ({ affectedRows: 1 })),
    mockTransaction: vi.fn(),
    mockCreateRelease: vi.fn(async () => true),
  };
});

vi.mock('@/repositories/userBalance.repository', () => ({
  tryDebitBalance: mockTryDebit,
  adjustBalance: mockAdjustBalance,
}));

vi.mock('@/repositories/creditLedger.repository', () => ({
  CreditLedgerRepository: {
    createRelease: mockCreateRelease,
  },
  DEFAULT_RUN_CREDIT_RESERVATION: 1,
}));

vi.mock('@/services/modelCredits.policy', () => ({
  estimateModelCredits: vi.fn(() => 0),
}));

function makeTx(opts?: { existingCharge?: boolean }) {
  return {
    orm: {
      public: {
        AgentRun: {
          where: vi.fn(() => ({
            first: vi.fn(async () => ({ ...mockRun })),
          })),
        },
        ToolInvocation: {
          where: vi.fn(() => ({
            first: vi.fn(async () => ({ ...mockInvocation })),
            update: vi.fn(async () => undefined),
          })),
        },
        CreditLedger: {
          where: vi.fn(() => ({
            first: vi.fn(async () =>
              opts?.existingCharge ? { id: 'existing-charge', type: 'CHARGE' } : null,
            ),
            all: mockLedgerAll,
          })),
          create: mockLedgerCreate,
        },
      },
    },
    execute: mockExecute,
  };
}

vi.mock('@/prisma/db', () => ({
  db: {
    transaction: mockTransaction,
    raw: {
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
        affectedCount: () => ({
          build: () => ({ strings, values }),
        }),
      }),
    },
  },
}));

import { CreditReservationService } from '@/services/creditReservation.service';
import { CreditService } from '@/services/credit.service';

describe('CreditReservationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.reservedCredits = 0;
    mockRun.settledCredits = 0;
    mockLedgerAll.mockResolvedValue([]);
    mockLedgerCreate.mockResolvedValue({});
    mockTryDebit.mockResolvedValue(true);
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeTx()),
    );
  });

  it('progressively tops up across several tools', async () => {
    const first = await CreditReservationService.ensureReservation({
      userId: 'user-1',
      agentRunId: 'run-1',
      needed: 1,
    });
    expect(first).toEqual({ reservedCredits: 1, topUp: 1 });
    expect(mockTryDebit).toHaveBeenCalledWith('user-1', 1, expect.anything());
    expect(mockLedgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RESERVATION',
        amount: -1,
        idempotencyKey: 'reserve:run-1:1',
      }),
    );

    mockRun.reservedCredits = 1;
    mockLedgerAll.mockResolvedValue([{}]);

    const second = await CreditReservationService.ensureReservation({
      userId: 'user-1',
      agentRunId: 'run-1',
      needed: 3,
    });
    expect(second).toEqual({ reservedCredits: 3, topUp: 2 });
    expect(mockTryDebit).toHaveBeenLastCalledWith('user-1', 2, expect.anything());
    expect(mockLedgerCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        idempotencyKey: 'reserve:run-1:2',
        amount: -2,
      }),
    );
  });

  it('returns early when outstanding already covers needed', async () => {
    mockRun.reservedCredits = 5;
    mockRun.settledCredits = 2;

    const result = await CreditReservationService.ensureReservation({
      userId: 'user-1',
      agentRunId: 'run-1',
      needed: 3,
    });

    expect(result).toEqual({ reservedCredits: 5, topUp: 0 });
    expect(mockTryDebit).not.toHaveBeenCalled();
    expect(mockLedgerCreate).not.toHaveBeenCalled();
  });

  it('throws InsufficientCreditsError when tryDebitBalance updates 0 rows', async () => {
    mockTryDebit.mockResolvedValue(false);

    await expect(
      CreditReservationService.ensureReservation({
        userId: 'user-1',
        agentRunId: 'run-1',
        needed: 2,
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
  });

  it('settles a tool invocation exactly once under a duplicate call', async () => {
    const first = await CreditReservationService.settleToolInvocation({
      toolInvocationId: 'inv-1',
      microcredits: 5_000,
    });
    expect(first).toEqual({ credits: 1, alreadySettled: false });
    expect(mockLedgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CHARGE',
        amount: -1,
        idempotencyKey: 'charge:tool:inv-1',
        toolInvocationId: 'inv-1',
      }),
    );

    mockLedgerCreate.mockRejectedValueOnce(
      new SqlQueryError('duplicate', { sqlState: '23505' }),
    );

    const second = await CreditReservationService.settleToolInvocation({
      toolInvocationId: 'inv-1',
      microcredits: 5_000,
    });
    expect(second).toEqual({ credits: 1, alreadySettled: true });
  });
});

describe('CreditService.finalizeRunBilling release math', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.reservedCredits = 5;
    mockRun.settledCredits = 2;
    mockRun.status = 'COMPLETED';
    mockCreateRelease.mockResolvedValue(true);
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeTx()),
    );
  });

  it('releases reservedCredits - settledCredits and credits the balance', async () => {
    await CreditService.finalizeRunBilling('user-1', 'run-1', 100, 'openrouter/free');

    expect(mockCreateRelease).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        agentRunId: 'run-1',
        releaseAmount: 3,
      },
      expect.anything(),
    );
    expect(mockAdjustBalance).toHaveBeenCalledWith('user-1', 3, expect.anything());
  });

  it('writes a zero CHARGE for free completed runs with no prior CHARGE', async () => {
    mockLedgerCreate.mockResolvedValue({});
    await CreditService.finalizeRunBilling('user-1', 'run-1', 10, 'openrouter/free');

    expect(mockLedgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        agentRunId: 'run-1',
        type: 'CHARGE',
        amount: 0,
        idempotencyKey: 'charge:model:run-1',
      }),
    );
  });

  it('does not write a zero CHARGE when a CHARGE already exists', async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeTx({ existingCharge: true })),
    );
    mockLedgerCreate.mockClear();
    await CreditService.finalizeRunBilling('user-1', 'run-1', 10, 'openrouter/free');
    expect(mockLedgerCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CHARGE', amount: 0 }),
    );
  });
});
