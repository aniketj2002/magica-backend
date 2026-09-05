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
   * Insert a reservation hold for a run. Idempotent via `reserve:${agentRunId}`
   * (legacy single-hold key) or `reserve:${agentRunId}:${seq}` for progressive top-ups.
   * Amount is negative (debit) on the ledger. Does not touch User.balance.
   */
  async createReservation(
    opts: {
      userId: string;
      agentRunId: string;
      amount: number;
      /** Progressive sequence; omit for legacy `reserve:${agentRunId}` key. */
      seq?: number;
    },
    client: OrmClient = db,
  ) {
    const amount = -Math.abs(opts.amount);
    const idempotencyKey =
      opts.seq !== undefined
        ? `reserve:${opts.agentRunId}:${opts.seq}`
        : `reserve:${opts.agentRunId}`;
    try {
      return await client.orm.public.CreditLedger.create({
        userId: opts.userId,
        agentRunId: opts.agentRunId,
        type: 'RESERVATION',
        amount,
        idempotencyKey,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return await client.orm.public.CreditLedger.where({
          idempotencyKey,
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

  async findRelease(agentRunId: string, client: OrmClient = db) {
    return await client.orm.public.CreditLedger.where({
      agentRunId,
      type: 'RELEASE',
    }).first();
  },

  /**
   * Insert a RELEASE for unused reservation. Idempotent via `release:${agentRunId}`.
   * @returns true when a new row was inserted.
   */
  async createRelease(
    opts: {
      userId: string;
      agentRunId: string;
      releaseAmount: number;
    },
    client: OrmClient = db,
  ): Promise<boolean> {
    const releaseAmount = Math.abs(opts.releaseAmount);
    if (releaseAmount === 0) return false;

    try {
      await client.orm.public.CreditLedger.create({
        userId: opts.userId,
        agentRunId: opts.agentRunId,
        type: 'RELEASE',
        amount: releaseAmount,
        idempotencyKey: `release:${opts.agentRunId}`,
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  },

  /**
   * @deprecated Prefer progressive settle + createRelease. Kept for older call sites.
   * Insert RELEASE + CHARGE (usage debit) in one statement.
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
