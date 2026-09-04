export type ProviderErrorKind =
  | 'rate_limit'
  | 'unavailable'
  | 'timeout'
  | 'auth'
  | 'invalid_request'
  | 'empty_stream'
  | 'malformed_tool_call'
  | 'unknown';

/**
 * Provider-independent error the orchestrator branches on for retry policy.
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options?: { retryable?: boolean; status?: number; cause?: unknown },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryable = options?.retryable ?? defaultRetryable(kind);
    this.status = options?.status;
    this.cause = options?.cause;
  }

  static isProviderError(error: unknown): error is ProviderError {
    return error instanceof ProviderError;
  }
}

function defaultRetryable(kind: ProviderErrorKind): boolean {
  switch (kind) {
    case 'rate_limit':
    case 'unavailable':
    case 'timeout':
      return true;
    case 'auth':
    case 'invalid_request':
    case 'empty_stream':
    case 'malformed_tool_call':
    case 'unknown':
      return false;
  }
}
