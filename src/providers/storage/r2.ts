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
    publicUrl: `${cfg.publicBaseUrl}/${opts.key}`,
  };
}
