import { createLogger } from '@/lib/logger';
import { putR2Object } from '@/providers/storage';
import { GeneratedAssetRepository } from '@/repositories/generatedAsset.repository';

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MiB
const log = createLogger({ component: 'media' });

export type MirrorToR2Result = {
  ok: true;
  key: string;
  publicUrl: string;
  sizeBytes: number;
  contentType: string | null;
} | {
  ok: false;
  reason: string;
  sourceUrl: string;
};

/**
 * Download `sourceUrl` and upload into R2. Returns failure (not throw) so callers
 * can fall back to the original URL without failing a paid tool call.
 */
export async function mirrorToR2(opts: {
  sourceUrl: string;
  key: string;
  contentType?: string;
  maxBytes?: number;
}): Promise<MirrorToR2Result> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  try {
    const res = await fetch(opts.sourceUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: `fetch failed with status ${res.status}`,
        sourceUrl: opts.sourceUrl,
      };
    }

    const contentLength = Number(res.headers.get('content-length') ?? '0');
    if (contentLength > maxBytes) {
      return {
        ok: false,
        reason: `content-length ${contentLength} exceeds cap ${maxBytes}`,
        sourceUrl: opts.sourceUrl,
      };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      return {
        ok: false,
        reason: `body ${buffer.byteLength} exceeds cap ${maxBytes}`,
        sourceUrl: opts.sourceUrl,
      };
    }

    const contentType =
      opts.contentType ??
      res.headers.get('content-type') ??
      undefined;

    const put = await putR2Object({
      key: opts.key,
      body: buffer,
      contentType,
    });

    return {
      ok: true,
      key: put.key,
      publicUrl: put.publicUrl,
      sizeBytes: buffer.byteLength,
      contentType: contentType ?? null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn('mirrorToR2 failed; falling back to sourceUrl', {
      sourceUrl: opts.sourceUrl,
      key: opts.key,
      reason,
    });
    return { ok: false, reason, sourceUrl: opts.sourceUrl };
  }
}

export type MirrorToolUrlsOpts = {
  sourceUrls: string[];
  userId: string;
  chatId: string;
  messageId: string;
  toolInvocationId: string;
  assetType: 'IMAGE' | 'VIDEO';
  /** File extension hint when URL has none (default png / mp4). */
  extension?: string;
};

/**
 * Mirror Magica output URLs into R2, persist GeneratedAsset rows, and return
 * durable URLs (or the original source URL when mirroring fails).
 */
export async function mirrorToolOutputUrls(
  opts: MirrorToolUrlsOpts,
): Promise<string[]> {
  const ext =
    opts.extension ?? (opts.assetType === 'VIDEO' ? 'mp4' : 'png');
  const durable: string[] = [];

  for (let i = 0; i < opts.sourceUrls.length; i++) {
    const sourceUrl = opts.sourceUrls[i]!;
    const key = `generated/${opts.userId}/${opts.toolInvocationId}/${i}.${ext}`;
    const mirrored = await mirrorToR2({ sourceUrl, key });

    if (mirrored.ok) {
      await GeneratedAssetRepository.create({
        userId: opts.userId,
        chatId: opts.chatId,
        messageId: opts.messageId,
        toolInvocationId: opts.toolInvocationId,
        type: opts.assetType,
        sourceUrl,
        storageProvider: 'r2',
        storageKey: mirrored.key,
        mimeType: mirrored.contentType,
        sizeBytes: mirrored.sizeBytes,
      });
      durable.push(mirrored.publicUrl);
    } else {
      await GeneratedAssetRepository.create({
        userId: opts.userId,
        chatId: opts.chatId,
        messageId: opts.messageId,
        toolInvocationId: opts.toolInvocationId,
        type: opts.assetType,
        sourceUrl,
        storageProvider: null,
        storageKey: null,
        metadata: { mirrorError: mirrored.reason },
      });
      durable.push(sourceUrl);
    }
  }

  return durable;
}

export const MediaService = {
  mirrorToR2,
  mirrorToolOutputUrls,
};
