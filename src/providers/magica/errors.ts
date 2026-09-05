export type MagicaErrorCode =
  | 'insufficient_provider_credits'
  | 'not_found'
  | 'unauthorized'
  | 'rate_limit'
  | 'unavailable'
  | 'invalid_request'
  | 'timeout'
  | 'unknown';

/**
 * Magica API error with a stable machine code for orchestration branching.
 */
export class MagicaError extends Error {
  readonly code: MagicaErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(
    code: MagicaErrorCode,
    message: string,
    options?: { status?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'MagicaError';
    this.code = code;
    this.status = options?.status;
    this.retryable = options?.retryable ?? defaultRetryable(code);
    this.cause = options?.cause;
  }

  static isMagicaError(error: unknown): error is MagicaError {
    return error instanceof MagicaError;
  }
}

function defaultRetryable(code: MagicaErrorCode): boolean {
  switch (code) {
    case 'rate_limit':
    case 'unavailable':
    case 'timeout':
      return true;
    default:
      return false;
  }
}
