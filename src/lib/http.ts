import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { AppError } from './errors';
import { requireUser } from '@/auth/requireUser';
import { log } from './logger';

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: init?.status ?? 200, headers: init?.headers });
}

export function jsonError(error: unknown, init?: ResponseInit): NextResponse {
  if (AppError.isAppError(error)) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: error.status, headers: init?.headers },
    );
  }

  log.error('Unhandled route error', {
    err: error instanceof Error ? error.message : String(error),
  });

  return NextResponse.json(
    {
      error: {
        code: 'internal_error',
        message: 'Internal server error',
      },
    },
    { status: 500, headers: init?.headers },
  );
}

type Awaitable<T> = T | Promise<T>;

type RouteParams = Record<string, string | string[] | undefined>;

type WithRouteOptions<TBody, TQuery, TParams> = {
  /** When true (default), resolve the authenticated local User via Clerk. */
  auth?: boolean;
  body?: z.ZodType<TBody>;
  query?: z.ZodType<TQuery>;
  params?: z.ZodType<TParams>;
};

type RouteHandlerContext<TBody, TQuery, TParams> = {
  request: Request;
  user: Awaited<ReturnType<typeof requireUser>> | null;
  body: TBody;
  query: TQuery;
  params: TParams;
};

type NextRouteContext = {
  params: Promise<RouteParams>;
};

/**
 * Route wrapper: optional Clerk auth, Zod parse for body/query/params, AppError mapping.
 */
export function withRoute<
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
>(
  options: WithRouteOptions<TBody, TQuery, TParams>,
  handler: (ctx: RouteHandlerContext<TBody, TQuery, TParams>) => Awaitable<Response>,
) {
  return async (request: Request, routeCtx?: NextRouteContext): Promise<Response> => {
    try {
      const needsAuth = options.auth !== false;
      const user = needsAuth ? await requireUser() : null;

      let body = undefined as TBody;
      if (options.body) {
        let raw: unknown = undefined;
        const method = request.method.toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          const text = await request.text();
          raw = text.length > 0 ? JSON.parse(text) : undefined;
        }
        const parsed = options.body.safeParse(raw);
        if (!parsed.success) {
          throw AppError.validation('Invalid request body', parsed.error.flatten());
        }
        body = parsed.data;
      }

      let query = undefined as TQuery;
      if (options.query) {
        const url = new URL(request.url);
        const entries = Object.fromEntries(url.searchParams.entries());
        const parsed = options.query.safeParse(entries);
        if (!parsed.success) {
          throw AppError.validation('Invalid query parameters', parsed.error.flatten());
        }
        query = parsed.data;
      }

      let params = undefined as TParams;
      if (options.params) {
        const rawParams = routeCtx?.params ? await routeCtx.params : {};
        const parsed = options.params.safeParse(rawParams);
        if (!parsed.success) {
          throw AppError.validation('Invalid path parameters', parsed.error.flatten());
        }
        params = parsed.data;
      } else if (routeCtx?.params) {
        params = (await routeCtx.params) as TParams;
      }

      return await handler({ request, user, body, query, params });
    } catch (error) {
      if (error instanceof SyntaxError) {
        return jsonError(AppError.validation('Invalid JSON body'));
      }
      return jsonError(error);
    }
  };
}
