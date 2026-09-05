import { isUniqueConstraintViolation } from '@prisma/orm-family-sql/errors';
import { db } from '@/prisma/db';
import type { OrmClient } from '@/prisma/orm';
import { InsufficientCreditsError } from '@/lib/credits-errors';
import {
  fromDecimal,
  toAppCredits,
  toDecimalString,
} from '@/providers/magica/credits';
import {
  tryDebitBalance,
  type SqlExecutor,
} from '@/repositories/userBalance.repository';

type TxClient = OrmClient & SqlExecutor;

async function bumpReservedCredits(
  agentRunId: string,
  topUp: number,
  client: SqlExecutor,
): Promise<void> {
  if (topUp === 0) return;
  const plan = db.raw.sql`
    UPDATE "public"."agentRun"
    SET "reservedCredits" = "reservedCredits" + ${topUp},
        "updatedAt" = NOW()
    WHERE "id" = ${agentRunId}
  `
    .affectedCount()
    .build();
  await client.execute(plan);
}

async function bumpSettledCredits(
  agentRunId: string,
  credits: number,
  client: SqlExecutor,
): Promise<void> {
  if (credits === 0) return;
  const plan = db.raw.sql`
    UPDATE "public"."agentRun"
    SET "settledCredits" = "settledCredits" + ${credits},
        "updatedAt" = NOW()
    WHERE "id" = ${agentRunId}
  `
    .affectedCount()
    .build();
  await client.execute(plan);
}

/**
 * Progressive credit reservation: top up the run hold when `needed` exceeds
 * outstanding (`reservedCredits - settledCredits`). Debits balance only via
 * the conditional `tryDebitBalance` path.
 */
export const CreditReservationService = {
  async ensureReservation(
    opts: {
      userId: string;
      agentRunId: string;
      needed: number;
    },
    client?: TxClient,
  ): Promise<{ reservedCredits: number; topUp: number }> {
    const needed = Math.max(0, opts.needed);

    const runInTx = async (tx: TxClient) => {
      const run = await tx.orm.public.AgentRun.where({
        id: opts.agentRunId,
      }).first();
      if (!run) {
        throw new Error(`AgentRun ${opts.agentRunId} not found`);
      }

      const reserved = fromDecimal(run.reservedCredits);
      const settled = fromDecimal(run.settledCredits);
      const outstanding = reserved - settled;
      if (outstanding >= needed) {
        return { reservedCredits: reserved, topUp: 0 };
      }

      const topUp = needed - outstanding;
      const debited = await tryDebitBalance(opts.userId, topUp, tx);
      if (!debited) {
        throw new InsufficientCreditsError();
      }

      const existingReservations = await tx.orm.public.CreditLedger.where({
        agentRunId: opts.agentRunId,
        type: 'RESERVATION',
      }).all();
      const seq = existingReservations.length + 1;

      try {
        await tx.orm.public.CreditLedger.create({
          userId: opts.userId,
          agentRunId: opts.agentRunId,
          type: 'RESERVATION',
          amount: toDecimalString(-Math.abs(topUp)),
          idempotencyKey: `reserve:${opts.agentRunId}:${seq}`,
        });
      } catch (error) {
        // Abort the tx so the conditional debit is rolled back; caller may retry.
        if (isUniqueConstraintViolation(error)) {
          throw new InsufficientCreditsError(
            'Credit reservation conflict; please retry',
          );
        }
        throw error;
      }

      await bumpReservedCredits(opts.agentRunId, topUp, tx);

      return {
        reservedCredits: reserved + topUp,
        topUp,
      };
    };

    if (client) return runInTx(client);
    return db.transaction(async (tx) => runInTx(tx as TxClient));
  },

  /**
   * Exactly-once CHARGE for a completed tool invocation. Balance is untouched
   * (already debited by reservation). Idempotent via `charge:tool:{id}`.
   */
  async settleToolInvocation(opts: {
    toolInvocationId: string;
    microcredits: number;
  }): Promise<{ credits: number; alreadySettled: boolean }> {
    const credits = toAppCredits(opts.microcredits);

    return db.transaction(async (tx) => {
      const invocation = await tx.orm.public.ToolInvocation.where({
        id: opts.toolInvocationId,
      }).first();
      if (!invocation) {
        throw new Error(`ToolInvocation ${opts.toolInvocationId} not found`);
      }

      const run = await tx.orm.public.AgentRun.where({
        id: invocation.agentRunId,
      }).first();
      if (!run) {
        throw new Error(`AgentRun ${invocation.agentRunId} not found`);
      }

      try {
        await tx.orm.public.CreditLedger.create({
          userId: run.userId,
          agentRunId: run.id,
          toolInvocationId: opts.toolInvocationId,
          type: 'CHARGE',
          amount: toDecimalString(-Math.abs(credits)),
          idempotencyKey: `charge:tool:${opts.toolInvocationId}`,
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          return { credits, alreadySettled: true };
        }
        throw error;
      }

      await tx.orm.public.ToolInvocation.where({
        id: opts.toolInvocationId,
      }).update({
        actualMicrocredits: opts.microcredits,
        actualCredits: toDecimalString(credits),
      });

      await bumpSettledCredits(run.id, credits, tx as TxClient);

      return { credits, alreadySettled: false };
    });
  },
};
