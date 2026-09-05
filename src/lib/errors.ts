export type AppErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'chat_run_active'
  | 'validation_error'
  | 'model_not_allowed'
  | 'payment_required'
  | 'internal_error'
  | (string & {});

/**
 * Application error with a stable machine code, HTTP status, and user-safe message.
 * Ownership / authorization failures MUST use 404 (not 403) so resource existence does not leak.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError('unauthorized', 401, message);
  }

  /** Prefer this for missing resources AND ownership failures (never 403). */
  static notFound(message = 'Not found'): AppError {
    return new AppError('not_found', 404, message);
  }

  static conflict(code: AppErrorCode = 'conflict', message = 'Conflict'): AppError {
    return new AppError(code, 409, message);
  }

  static validation(message = 'Invalid request', details?: unknown): AppError {
    return new AppError('validation_error', 422, message, details);
  }

  static modelNotAllowed(modelId: string): AppError {
    return new AppError(
      'model_not_allowed',
      422,
      `Model "${modelId}" is not allowed`,
      { modelId },
    );
  }

  static paymentRequired(message = 'Insufficient credits'): AppError {
    return new AppError('payment_required', 402, message);
  }

  static internal(message = 'Internal server error', details?: unknown): AppError {
    return new AppError('internal_error', 500, message, details);
  }

  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }
}
