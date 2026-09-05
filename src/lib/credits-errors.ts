import { AppError } from '@/lib/errors';

/** Thrown when a progressive reservation top-up cannot debit the user balance. */
export class InsufficientCreditsError extends AppError {
  constructor(message = 'Insufficient credits') {
    super('payment_required', 402, message);
    this.name = 'InsufficientCreditsError';
  }

  static isInsufficientCreditsError(
    error: unknown,
  ): error is InsufficientCreditsError {
    return error instanceof InsufficientCreditsError;
  }
}
