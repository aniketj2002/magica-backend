import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';

let client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (client) return client;
  const cfg = env.requireR2Config();
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return client;
}

/** Test helper — drop the cached S3 client. */
export function clearR2Client(): void {
  client = null;
}

/** Durable public URL for an object key (uses R2_PUBLIC_BASE_URL). */
export function publicObjectUrl(key: string): string {
  const base = env.requireR2Config().publicBaseUrl;
  return `${base}/${key.replace(/^\/+/, '')}`;
}

/**
 * If `url` points at the private R2 S3 API host for our bucket, rewrite it to
 * R2_PUBLIC_BASE_URL + object key. Otherwise return unchanged.
 */
export function rewritePrivateR2Url(url: string): string {
  const key = storageKeyFromPrivateR2Url(url);
  if (!key) return url;
  return publicObjectUrl(key);
}

/** Extract object key from a private R2 API URL for our account/bucket. */
export function storageKeyFromPrivateR2Url(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith('.r2.cloudflarestorage.com')) return null;

  const cfg = env.requireR2Config();
  const accountHost = `${cfg.accountId.toLowerCase()}.r2.cloudflarestorage.com`;
  const virtualHost = `${cfg.bucket.toLowerCase()}.${cfg.accountId.toLowerCase()}.r2.cloudflarestorage.com`;

  let key = parsed.pathname.replace(/^\/+/, '');
  if (!key) return null;

  if (host === accountHost) {
    // Path-style: {account}.r2.cloudflarestorage.com/{bucket}/{key}
    const prefix = `${cfg.bucket}/`;
    if (!key.startsWith(prefix)) return null;
    key = key.slice(prefix.length);
    return key || null;
  }

  if (host === virtualHost) {
    // Virtual-hosted: {bucket}.{account}.r2.cloudflarestorage.com/{key}
    return key;
  }

  return null;
}

export async function putR2Object(opts: {
  key: string;
  body: Uint8Array | Buffer;
  contentType?: string;
}): Promise<{ key: string; publicUrl: string }> {
  const cfg = env.requireR2Config();
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    }),
  );
  return {
    key: opts.key,
    publicUrl: publicObjectUrl(opts.key),
  };
}
