import { Temporal } from '@js-temporal/polyfill';

/** Instant for Prisma Next DateTime writes (`updatedAt`, heartbeats, etc.). */
export function now(): Temporal.Instant {
  return Temporal.Now.instant();
}
