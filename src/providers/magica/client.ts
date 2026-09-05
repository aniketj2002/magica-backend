import { env } from '@/lib/env';
import { MagicaError } from './errors';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 1;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export type MagicaRequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Skip Authorization header (e.g. public catalog). */
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function baseUrl(): string {
  return env.MAGICA_API_BASE_URL.replace(/\/$/, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as {
      error?: string;
      message?: string;
      code?: string;
    };
    return json.message ?? json.error ?? response.statusText;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

export async function mapMagicaHttpError(response: Response): Promise<MagicaError> {
  const message = await readErrorMessage(response);
  const status = response.status;

  if (status === 403) {
    return new MagicaError('insufficient_provider_credits', message, {
      status,
      retryable: false,
    });
  }
  if (status === 401) {
    return new MagicaError('unauthorized', message, { status, retryable: false });
  }
  if (status === 404) {
    return new MagicaError('not_found', message, { status, retryable: false });
  }
  if (status === 400) {
    return new MagicaError('invalid_request', message, { status, retryable: false });
  }
  if (status === 429) {
    return new MagicaError('rate_limit', message, { status, retryable: true });
  }
  if (status >= 500) {
    return new MagicaError('unavailable', message, { status, retryable: true });
  }
  return new MagicaError('unknown', message, { status, retryable: false });
}

/**
 * Fetch wrapper for Magica Inference API: auth, timeout, retry on 429/5xx.
 */
export async function magicaFetch(
  path: string,
  options: MagicaRequestOptions = {},
): Promise<Response> {
  const method = options.method ?? 'GET';
  const useAuth = options.auth !== false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (useAuth) {
        headers.Authorization = `Bearer ${env.requireMagicaApiKey()}`;
      }
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
        await response.arrayBuffer().catch(() => undefined);
        await sleep(backoffMs(attempt));
        continue;
      }

      return response;
    } catch (cause) {
      lastError = cause;
      const aborted =
        (cause instanceof Error && cause.name === 'AbortError') ||
        options.signal?.aborted === true;

      if (aborted && options.signal?.aborted) {
        throw cause;
      }
      if (aborted) {
        throw new MagicaError('timeout', 'Magica request timed out', {
          retryable: true,
          cause,
        });
      }
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new MagicaError('unavailable', 'Magica request failed', {
        retryable: true,
        cause,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  throw new MagicaError('unavailable', 'Magica request failed', {
    retryable: true,
    cause: lastError,
  });
}

export async function magicaJson<T>(
  path: string,
  options: MagicaRequestOptions,
  parse: (data: unknown) => T,
): Promise<T> {
  const response = await magicaFetch(path, options);
  if (!response.ok) {
    throw await mapMagicaHttpError(response);
  }
  const data: unknown = await response.json();
  return parse(data);
}
