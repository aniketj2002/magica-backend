import { db } from '@/prisma/db';
import type { OrmClient } from '@/prisma/orm';
import type { SqlExecutor } from '@/repositories/userBalance.repository';
import { adjustBalance } from '@/repositories/userBalance.repository';
import {
  CreditLedgerRepository,
  DEFAULT_RUN_CREDIT_RESERVATION,
} from '@/repositories/creditLedger.repository';

type TxClient = OrmClient & SqlExecutor;

/**
 * Credits orchestration lives here — ledger rows in the repository,
 * User.balance updates via atomic `balance = balance + delta`.
 */
export const CreditService = {
  /**
   * Reserve credits for a run: atomic balance debit + RESERVATION ledger row.
   */
  async reserveForRun(
    opts: {
      userId: string;
      agentRunId: string;
      amount?: number;
    },
    client: TxClient,
  ) {
    const amount = opts.amount ?? DEFAULT_RUN_CREDIT_RESERVATION;

    await adjustBalance(opts.userId, -Math.abs(amount), client);
    await CreditLedgerRepository.createReservation(
      {
        userId: opts.userId,
        agentRunId: opts.agentRunId,
        amount,
      },
      client,
    );
  },

  /**
   * Finalize billing: insert RELEASE + CHARGE together, then credit back the
   * unused reservation (net = release − usage) with an atomic balance add.
   */
  async finalizeRunBilling(
    userId: string,
    agentRunId: string,
    tokensUsed: number,
  ): Promise<void> {
    // Example pricing: 1 credit per 1000 tokens (OpenRouter free → 0 today).
    const usageAmount = Math.ceil(Math.max(0, tokensUsed) / 1000);

    await db.transaction(async (tx) => {
      const reservation = await CreditLedgerRepository.findReservation(
        agentRunId,
        tx,
      );
      if (!reservation) return;

      const releaseAmount = Math.abs(reservation.amount);

      await CreditLedgerRepository.createReleaseAndCharge(
        {
          userId,
          agentRunId,
          releaseAmount,
          chargeAmount: usageAmount,
        },
        tx,
      );

      // Return unused hold: +release, then −usage is already expressed as net.
      const netDelta = releaseAmount - usageAmount;
      await adjustBalance(userId, netDelta, tx);
    });
  },
};

export { DEFAULT_RUN_CREDIT_RESERVATION };
