/**
 * Byte-stream → SSE event parser for OpenRouter (and OpenAI-compatible) streams.
 * Buffers across TCP chunks, splits on blank-line event boundaries, skips `:` comments,
 * yields parsed JSON objects, and stops on `[DONE]`.
 */
export async function* parseSseJsonStream(
  body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncGenerator<unknown, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of iterateBytes(body)) {
    buffer += decoder.decode(chunk, { stream: true });

    // Normalize CRLF so we can split on \n\n reliably.
    buffer = buffer.replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLines: string[] = [];
      for (const line of rawEvent.split('\n')) {
        if (line.length === 0) continue;
        // SSE comment / keep-alive (e.g. `: OPENROUTER PROCESSING`)
        if (line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
          continue;
        }
        // Ignore other SSE fields (event:, id:, retry:).
      }

      if (dataLines.length === 0) {
        boundary = buffer.indexOf('\n\n');
        continue;
      }

      const data = dataLines.join('\n');
      if (data === '[DONE]') {
        return;
      }

      try {
        yield JSON.parse(data) as unknown;
      } catch (cause) {
        throw new SseParseError(`Malformed SSE JSON: ${data.slice(0, 200)}`, { cause });
      }

      boundary = buffer.indexOf('\n\n');
    }
  }

  // Flush decoder and any trailing event without a final blank line.
  buffer += decoder.decode();
  buffer = buffer.replace(/\r\n/g, '\n').trimEnd();
  if (buffer.length > 0) {
    const dataLines: string[] = [];
    for (const line of buffer.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length > 0) {
      const data = dataLines.join('\n');
      if (data !== '[DONE]') {
        try {
          yield JSON.parse(data) as unknown;
        } catch (cause) {
          throw new SseParseError(`Malformed SSE JSON: ${data.slice(0, 200)}`, { cause });
        }
      }
    }
  }
}

export class SseParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'SseParseError';
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

async function* iterateBytes(
  body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array, void, undefined> {
  if (Symbol.asyncIterator in body) {
    yield* body;
    return;
  }

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
