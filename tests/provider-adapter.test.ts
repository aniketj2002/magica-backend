import { afterEach, describe, expect, it, vi } from 'vitest';
import { openRouterProvider } from '@/providers/llm/openrouter/adapter';
import { ProviderError } from '@/providers/llm/errors';
import type { ProviderEvent } from '@/providers/llm/types';

/**
 * Provider HTTP is stubbed with `vi.stubGlobal('fetch', ...)`.
 * MSW's `setupServer().listen()` hangs under the current Node/vitest
 * combination in this repo (localStorage / interceptor init), so fetch
 * stubbing is the reliable path for adapter error-mapping tests.
 */

async function collect(
  iter: AsyncIterable<ProviderEvent>,
): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

function sseResponse(chunks: string[], status = 200): Response {
  const body =
    chunks.map((c) => `data: ${c}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const baseReq = {
  modelId: 'openrouter/free',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('OpenRouterProvider error mapping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps 429 to rate_limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('slow down', { status: 429 })),
    );

    await expect(
      collect(
        openRouterProvider.stream(baseReq, {
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'rate_limit',
      retryable: true,
      status: 429,
    } satisfies Partial<ProviderError>);
  });

  it('maps 5xx to unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 503 })),
    );

    await expect(
      collect(
        openRouterProvider.stream(baseReq, {
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true,
      status: 503,
    });
  });

  it('maps zero-delta streams to empty_stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          JSON.stringify({
            model: 'openrouter/free',
            choices: [{ delta: {}, finish_reason: 'stop' }],
          }),
        ]),
      ),
    );

    await expect(
      collect(
        openRouterProvider.stream(baseReq, {
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toMatchObject({
      kind: 'empty_stream',
      retryable: false,
    });
  });

  it('extracts modelActual via model-resolved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          JSON.stringify({
            model: 'meta-llama/llama-3.3-70b-instruct',
            choices: [{ delta: { content: 'hello' } }],
          }),
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        ]),
      ),
    );

    const events = await collect(
      openRouterProvider.stream(baseReq, {
        signal: new AbortController().signal,
      }),
    );

    expect(events[0]).toEqual({
      type: 'model-resolved',
      model: 'meta-llama/llama-3.3-70b-instruct',
    });
    expect(events.some((e) => e.type === 'text-delta' && e.text === 'hello')).toBe(
      true,
    );
    expect(events.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
  });
});
