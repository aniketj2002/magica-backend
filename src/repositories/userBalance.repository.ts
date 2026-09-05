import { db } from '@/prisma/db';
import { AppError } from '@/lib/errors';

/** Client that can run a built SQL plan (transaction `tx` or `db.runtime()`). */
export type SqlExecutor = {
  execute(plan: unknown): Promise<{ affectedRows: number }>;
};

function resolveExecutor(client?: SqlExecutor): SqlExecutor {
  if (client) return client;
  return db.runtime();
}

/**
 * Atomically apply `delta` to `user.balance` (`balance = balance + delta`).
 * Balance may go negative.
 */
export async function adjustBalance(
  userId: string,
  delta: number,
  client?: SqlExecutor,
): Promise<void> {
  if (delta === 0) return;

  const plan = db.raw.sql`
    UPDATE "public"."user"
    SET "balance" = "balance" + ${delta},
        "updatedAt" = NOW()
    WHERE "id" = ${userId}
  `
    .affectedCount()
    .build();

  const stats = await resolveExecutor(client).execute(plan);
  if (stats.affectedRows === 0) {
    throw AppError.notFound('User not found');
  }
}

/**
 * Conditionally debit `amount` only when balance is sufficient.
 * Returns true when the row was updated; false when balance was too low
 * (or the user was missing).
 */
export async function tryDebitBalance(
  userId: string,
  amount: number,
  client?: SqlExecutor,
): Promise<boolean> {
  if (amount < 0) {
    throw new Error('tryDebitBalance amount must be non-negative');
  }
  if (amount === 0) return true;

  const plan = db.raw.sql`
    UPDATE "public"."user"
    SET "balance" = "balance" - ${amount},
        "updatedAt" = NOW()
    WHERE "id" = ${userId}
      AND "balance" >= ${amount}
  `
    .affectedCount()
    .build();

  return (await resolveExecutor(client).execute(plan)).affectedRows === 1;
}
