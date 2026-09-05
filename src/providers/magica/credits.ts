import { env } from '@/lib/env';

export const MICROCREDITS_PER_CREDIT = 1_000_000;

/** App-credit display/storage precision (matches Magica microcredit granularity). */
export const APP_CREDIT_SCALE = 6;

/**
 * Magica microcredits → application credits (exact fraction, no ceil/floor/min).
 * Rounded to {@link APP_CREDIT_SCALE} decimal places.
 */
export function toAppCredits(microcredits: number): number {
  if (microcredits <= 0) return 0;
  return roundAppCredits(
    (microcredits / MICROCREDITS_PER_CREDIT) * env.MAGICA_CREDIT_MARKUP,
  );
}

export function roundAppCredits(value: number): number {
  return Number(value.toFixed(APP_CREDIT_SCALE));
}

/**
 * Canonical numeric text for Prisma `Decimal` / Postgres `numeric` columns.
 * Rejects scientific notation so values round-trip through the codec.
 */
export function toDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('Credit amount must be finite');
  }
  if (value === 0) return '0';
  const fixed = roundAppCredits(value).toFixed(APP_CREDIT_SCALE);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** Coerce a Decimal column (string) or number into a JS number for math. */
export function fromDecimal(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
