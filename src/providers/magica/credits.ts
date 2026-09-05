import { env } from '@/lib/env';

export const MICROCREDITS_PER_CREDIT = 1_000_000;

/**
 * Magica microcredits → whole application credits (ceil, never below 1 for
 * billable work). Exact microcredits are still persisted for auditability.
 */
export function toAppCredits(microcredits: number): number {
  if (microcredits <= 0) return 0;
  return Math.max(
    1,
    Math.ceil((microcredits / MICROCREDITS_PER_CREDIT) * env.MAGICA_CREDIT_MARKUP),
  );
}
