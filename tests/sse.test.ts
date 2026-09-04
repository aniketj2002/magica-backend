import { describe, expect, it } from 'vitest';
import { parseSseJsonStream, SseParseError } from '@/providers/llm/openrouter/sse';

function encode(parts: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        yield encoder.encode(part);
      }
    },
  };
}

async function collect(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('parseSseJsonStream', () => {
  it('skips colon keep-alive comments', async () => {
    const events = await collect(
      parseSseJsonStream(
        encode([
          ': OPENROUTER PROCESSING\n\n',
          'data: {"id":"1","choices":[{"delta":{"content":"hi"}}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    expect(events).toEqual([{ id: '1', choices: [{ delta: { content: 'hi' } }] }]);
  });

  it('splits events across TCP chunks on blank lines', async () => {
    const events = await collect(
      parseSseJsonStream(
        encode([
          'data: {"n":',
          '1}\n\n',
          'data: {"n":2}\n',
          '\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    expect(events).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('terminates on [DONE]', async () => {
    const events = await collect(
      parseSseJsonStream(
        encode([
          'data: {"ok":true}\n\n',
          'data: [DONE]\n\n',
          'data: {"should":"not appear"}\n\n',
        ]),
      ),
    );
    expect(events).toEqual([{ ok: true }]);
  });

  it('handles a trailing usage chunk after finish', async () => {
    const events = await collect(
      parseSseJsonStream(
        encode([
          'data: {"choices":[{"delta":{"content":"a"},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });

  it('throws SseParseError on malformed JSON', async () => {
    await expect(
      collect(parseSseJsonStream(encode(['data: {not-json}\n\n']))),
    ).rejects.toBeInstanceOf(SseParseError);
  });
});
