import { isUniqueConstraintViolation } from '@prisma/orm-family-sql/errors';
import { Temporal } from '@js-temporal/polyfill';
import { db } from '@/prisma/db';
import { instantToIso } from '@/lib/cursor';
import type { OrmClient } from '@/prisma/orm';
import type { SqlExecutor } from '@/repositories/userBalance.repository';
import { adjustBalance } from '@/repositories/userBalance.repository';
import {
  CreditLedgerRepository,
  DEFAULT_RUN_CREDIT_RESERVATION,
} from '@/repositories/creditLedger.repository';
import { CreditReservationService } from '@/services/creditReservation.service';
import { estimateModelCredits } from '@/services/modelCredits.policy';
import { fromDecimal, toDecimalString } from '@/providers/magica/credits';

/** Prisma DateTime fields are Temporal.Instant — never pass them to `new Date(x)`. */
function toInstant(value: unknown): Temporal.Instant {
  if (value instanceof Temporal.Instant) return value;
  return Temporal.Instant.from(instantToIso(value));
}

type TxClient = OrmClient & SqlExecutor;

export type CreditUsageStep = {
  label: string;
  createdAt: string;
  /** Signed cost: positive = debit/hold, negative = credit/refund. */
  cost: number;
  type: string;
};

export type CreditUsageItem = {
  id: string;
  toolName: string;
  /** Net debit/credit shown in the table (CHARGE or adjustment amount). */
  amount: number;
  /** Absolute RESERVATION hold for this agent run (0 if none). */
  reserved: number;
  /** Absolute RELEASE / unreserve for this agent run (0 if none). */
  released: number;
  direction: 'debit' | 'credit';
  ledgerType: string;
  agentRunId: string | null;
  createdAt: string;
  steps: CreditUsageStep[];
};

export type CreditUsageShow = 'debited' | 'credited' | 'all';

export type CreditUsageSummary = {
  totalDebited: number;
  totalCredited: number;
  totalExecutions: number;
  categories: number;
  periodStart: string;
  periodEnd: string;
  items: CreditUsageItem[];
};

/**
 * Credits orchestration lives here — ledger rows in the repository,
 * User.balance updates via atomic `balance = balance + delta`.
 */
export const CreditService = {
  /**
   * Reserve credits for a run via progressive `ensureReservation`
   * (conditional balance debit → 402 when insufficient).
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
    await CreditReservationService.ensureReservation(
      {
        userId: opts.userId,
        agentRunId: opts.agentRunId,
        needed: amount,
      },
      client,
    );
  },

  /**
   * Finalize billing: release unused reservation
   * (`reservedCredits - settledCredits`). Tool CHARGE rows are written at
   * settlement time; model token usage is tracked but priced via
   * {@link estimateModelCredits} (0 for OpenRouter today).
   *
   * Free (zero-cost) completed runs still get a CHARGE of 0 so usage analytics
   * include them even though no balance was reserved or debited.
   */
  async finalizeRunBilling(
    userId: string,
    agentRunId: string,
    tokensUsed: number,
    modelId?: string | null,
  ): Promise<void> {
    const modelCost = estimateModelCredits({ totalTokens: tokensUsed }, modelId);

    await db.transaction(async (tx) => {
      const run = await tx.orm.public.AgentRun.where({ id: agentRunId }).first();
      if (!run) return;

      const reserved = fromDecimal(run.reservedCredits);
      const settled = fromDecimal(run.settledCredits);
      const releaseAmount = Math.max(0, reserved - settled);
      if (releaseAmount > 0 || reserved > 0) {
        const created = await CreditLedgerRepository.createRelease(
          {
            userId,
            agentRunId,
            releaseAmount,
          },
          tx,
        );

        if (created && releaseAmount > 0) {
          await adjustBalance(userId, releaseAmount, tx);
        }
      }

      // Free models (cost 0) still need a usage row. Only COMPLETED runs, and
      // only when no CHARGE already exists (tools may have charged instead).
      if (run.status === 'COMPLETED' && modelCost === 0) {
        await ensureFreeRunUsageCharge(userId, agentRunId, tx);
      }
    });
  },

  /**
   * List credit ledger usage as one row per message execution (CHARGE) or
   * credit event. Regenerations create separate AgentRuns → separate rows.
   */
  async getUsage(opts: {
    userId: string;
    from?: string;
    to?: string;
    show?: CreditUsageShow;
  }): Promise<CreditUsageSummary> {
    const show: CreditUsageShow = opts.show ?? 'debited';
    const now = Temporal.Now.instant();
    const periodStart = opts.from
      ? Temporal.Instant.from(new Date(opts.from).toISOString())
      : Temporal.Instant.from(
          new Date(
            new Date().getFullYear(),
            new Date().getMonth(),
            1,
          ).toISOString(),
        );
    const periodEnd = opts.to
      ? Temporal.Instant.from(new Date(opts.to).toISOString())
      : now;

    const entries = await db.orm.public.CreditLedger.where({
      userId: opts.userId,
    }).all();

    const inPeriod = entries.filter((c) => {
      const createdAt = toInstant(c.createdAt);
      return (
        Temporal.Instant.compare(createdAt, periodStart) >= 0 &&
        Temporal.Instant.compare(createdAt, periodEnd) <= 0
      );
    });

    // Hold/release may fall outside the period window — still attach by agentRunId.
    const byRun = new Map<
      string,
      {
        reservation?: { amount: number; createdAt: unknown };
        release?: { amount: number; createdAt: unknown };
        charge?: { amount: number; createdAt: unknown };
      }
    >();

    for (const entry of entries) {
      if (!entry.agentRunId) continue;
      const bucket = byRun.get(entry.agentRunId) ?? {};
      if (entry.type === 'RESERVATION') {
        const prev = bucket.reservation?.amount ?? 0;
        bucket.reservation = {
          amount: prev + Math.abs(fromDecimal(entry.amount)),
          createdAt: bucket.reservation?.createdAt ?? entry.createdAt,
        };
      } else if (entry.type === 'RELEASE') {
        bucket.release = {
          amount: Math.abs(fromDecimal(entry.amount)),
          createdAt: entry.createdAt,
        };
      } else if (entry.type === 'CHARGE') {
        const prev = bucket.charge?.amount ?? 0;
        bucket.charge = {
          amount: prev + Math.abs(fromDecimal(entry.amount)),
          createdAt: bucket.charge?.createdAt ?? entry.createdAt,
        };
      }
      byRun.set(entry.agentRunId, bucket);
    }

    const items: CreditUsageItem[] = [];

    for (const entry of inPeriod) {
      const direction = classifyDirection(entry.type, fromDecimal(entry.amount));
      if (!direction) continue;
      if (show === 'debited' && direction !== 'debit') continue;
      if (show === 'credited' && direction !== 'credit') continue;

      const agentRunId = entry.agentRunId ?? null;
      const runLedger = agentRunId ? byRun.get(agentRunId) : undefined;
      const reserved = runLedger?.reservation?.amount ?? 0;
      const released = runLedger?.release?.amount ?? 0;

      items.push({
        id: entry.id,
        toolName: toolNameForEntry(entry.type, agentRunId),
        amount: Math.abs(fromDecimal(entry.amount)),
        reserved,
        released,
        direction,
        ledgerType: entry.type,
        agentRunId,
        createdAt: instantToIso(entry.createdAt),
        steps: buildSteps(
          { type: entry.type, amount: fromDecimal(entry.amount), createdAt: entry.createdAt },
          runLedger,
        ),
      });
    }

    items.sort(
      (a, b) =>
        Temporal.Instant.compare(toInstant(b.createdAt), toInstant(a.createdAt)),
    );

    const debitItems = items.filter((i) => i.direction === 'debit');
    const creditItems = items.filter((i) => i.direction === 'credit');
    const totalDebited = debitItems.reduce((s, i) => s + i.amount, 0);
    const totalCredited = creditItems.reduce((s, i) => s + i.amount, 0);
    const categories = new Set(items.map((i) => i.toolName)).size;

    return {
      totalDebited,
      totalCredited,
      totalExecutions: debitItems.length,
      categories,
      periodStart: instantToIso(periodStart),
      periodEnd: instantToIso(periodEnd),
      items,
    };
  },
};

function classifyDirection(
  type: string,
  amount: number,
): 'debit' | 'credit' | null {
  // Each CHARGE = one message/regen execution row.
  if (type === 'CHARGE') return 'debit';
  if (type === 'REFUND') return 'credit';
  if (type === 'ADJUSTMENT') return amount < 0 ? 'debit' : 'credit';
  // RESERVATION / RELEASE are internal holds — not usage analytics rows.
  return null;
}

function toolNameForEntry(type: string, _agentRunId: string | null): string {
  if (type === 'CHARGE') return 'AI Agent Chat';
  if (type === 'REFUND') return 'Refund';
  if (type === 'ADJUSTMENT') return 'Balance Adjustment';
  return type;
}

/**
 * Idempotent zero CHARGE for free model runs so usage analytics can list them.
 * No balance is touched — amount is 0.
 */
async function ensureFreeRunUsageCharge(
  userId: string,
  agentRunId: string,
  tx: TxClient,
): Promise<void> {
  const existing = await tx.orm.public.CreditLedger.where({
    agentRunId,
    type: 'CHARGE',
  }).first();
  if (existing) return;

  try {
    await tx.orm.public.CreditLedger.create({
      userId,
      agentRunId,
      type: 'CHARGE',
      amount: toDecimalString(0),
      idempotencyKey: `charge:model:${agentRunId}`,
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return;
    }
    throw error;
  }
}

type RunLedger = {
  reservation?: { amount: number; createdAt: unknown };
  release?: { amount: number; createdAt: unknown };
  charge?: { amount: number; createdAt: unknown };
};

function buildSteps(
  entry: { type: string; amount: number; createdAt: unknown },
  runLedger: RunLedger | undefined,
): CreditUsageStep[] {
  const steps: CreditUsageStep[] = [];

  if (runLedger?.reservation) {
    steps.push({
      label: 'AI LLM Admission Reservation',
      createdAt: instantToIso(runLedger.reservation.createdAt),
      cost: runLedger.reservation.amount,
      type: 'RESERVATION',
    });
  }

  if (runLedger?.release) {
    steps.push({
      label: 'AI Process Refund',
      createdAt: instantToIso(runLedger.release.createdAt),
      // Negative = unreserve / credit back.
      cost: -runLedger.release.amount,
      type: 'RELEASE',
    });
  }

  const chargeAmount = runLedger?.charge?.amount ?? 0;
  if (runLedger?.charge) {
    steps.push({
      label: 'AI Agent Chat Usage',
      createdAt: instantToIso(runLedger.charge.createdAt),
      cost: chargeAmount,
      type: 'CHARGE',
    });
  }

  // Non-run ledger rows (refunds / adjustments) — single step.
  if (steps.length === 0) {
    const signed =
      entry.type === 'REFUND' || entry.amount > 0
        ? -Math.abs(entry.amount)
        : Math.abs(entry.amount);
    steps.push({
      label: toolNameForEntry(entry.type, null),
      createdAt: instantToIso(entry.createdAt),
      cost: signed,
      type: entry.type,
    });
  }

  steps.sort((a, b) =>
    Temporal.Instant.compare(toInstant(a.createdAt), toInstant(b.createdAt)),
  );
  return steps;
}

export { DEFAULT_RUN_CREDIT_RESERVATION, estimateModelCredits };
