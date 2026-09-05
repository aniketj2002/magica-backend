import { Temporal } from '@js-temporal/polyfill';
import { AppError } from '@/lib/errors';

export type KeysetCursor = {
  createdAt: Temporal.Instant;
  id: string;
};

/** Encode a keyset cursor for API clients (`createdAt|id`, base64url). */
export function encodeCursor(cursor: KeysetCursor): string {
  const payload = `${cursor.createdAt.toString()}|${cursor.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/** Decode a keyset cursor from the API. Throws AppError.validation on bad input. */
export function decodeCursor(raw: string): KeysetCursor {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    if (sep <= 0 || sep === decoded.length - 1) {
      throw new Error('missing separator');
    }
    const createdAtRaw = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    const createdAt = Temporal.Instant.from(createdAtRaw);
    if (!id) throw new Error('empty id');
    return { createdAt, id };
  } catch {
    throw AppError.validation('Invalid cursor');
  }
}

/** Instant / unknown → ISO string for JSON responses. */
export function instantToIso(value: unknown): string {
  if (value instanceof Temporal.Instant) {
    return value.toString();
  }
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toString' in value) {
    return String((value as { toString(): string }).toString());
  }
  return String(value);
}
