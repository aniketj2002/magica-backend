import { isUniqueConstraintViolation } from '@prisma/orm-family-sql/errors';
import { db } from '../prisma/db';
import type { OrmClient } from '../prisma/orm';

/** Fixed minimum reservation for an agent run (tools charge separately later). */
export const DEFAULT_RUN_CREDIT_RESERVATION = 1;

export const CreditLedgerRepository = {
  async addAdjustment(userId: string, amount: number) {
    return await db.orm.public.CreditLedger.create({
      userId,
      type: 'ADJUSTMENT',
      amount,
    });
  },

  /**
   * Insert a reservation hold for a run. Idempotent via `reserve:${agentRunId}`.
   * Amount is negative (debit) on the ledger. Does not touch User.balance.
   */
  async createReservation(
    opts: {
      userId: string;
      agentRunId: string;
      amount: number;
    },
    client: OrmClient = db,
  ) {
    const amount = -Math.abs(opts.amount);
    try {
      return await client.orm.public.CreditLedger.create({
        userId: opts.userId,
        agentRunId: opts.agentRunId,
        type: 'RESERVATION',
        amount,
        idempotencyKey: `reserve:${opts.agentRunId}`,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return await client.orm.public.CreditLedger.where({
          idempotencyKey: `reserve:${opts.agentRunId}`,
        }).first();
      }
      throw error;
    }
  },

  async findReservation(agentRunId: string, client: OrmClient = db) {
    return await client.orm.public.CreditLedger.where({
      agentRunId,
      type: 'RESERVATION',
    }).first();
  },

  /**
   * Insert RELEASE + CHARGE (usage debit) in one statement.
   * Idempotent via unique keys; unique violations are treated as already applied.
   */
  async createReleaseAndCharge(
    opts: {
      userId: string;
      agentRunId: string;
      releaseAmount: number;
      chargeAmount: number;
    },
    client: OrmClient = db,
  ) {
    const releaseAmount = Math.abs(opts.releaseAmount);
    const chargeAmount = -Math.abs(opts.chargeAmount);

    try {
      await client.orm.public.CreditLedger.createAndCount([
        {
          userId: opts.userId,
          agentRunId: opts.agentRunId,
          type: 'RELEASE',
          amount: releaseAmount,
          idempotencyKey: `release:${opts.agentRunId}`,
        },
        {
          userId: opts.userId,
          agentRunId: opts.agentRunId,
          type: 'CHARGE',
          amount: chargeAmount,
          idempotencyKey: `charge:${opts.agentRunId}`,
        },
      ]);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return;
      }
      throw error;
    }
  },
};
