import { createHmac, timingSafeEqual } from 'node:crypto';
import { Transloadit } from 'transloadit';
import { env } from '@/lib/env';

export type DirectUploadParams = {
  auth: {
    key: string;
    expires: string;
  };
  notify_url: string;
  fields: {
    attachmentId: string;
  };
  steps: {
    store: {
      robot: '/cloudflare/store';
      use: ':original';
      credentials: string;
      path: string;
    };
  };
};

/**
 * Build Transloadit assembly params + sha384 signature for browser direct upload.
 */
export function createDirectUploadSignature(opts: {
  userId: string;
  attachmentId: string;
  /** ISO expires; defaults to ~1 hour from now via the SDK when omitted. */
  expires?: string;
}): { params: string; signature: string; parsed: DirectUploadParams } {
  const auth = env.requireTransloaditAuth();
  if (!env.APP_PUBLIC_URL) {
    throw new Error('APP_PUBLIC_URL is required for Transloadit uploads');
  }

  const client = new Transloadit({
    authKey: auth.key,
    authSecret: auth.secret,
  });

  const parsed: DirectUploadParams = {
    auth: {
      key: auth.key,
      expires:
        opts.expires ??
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    notify_url: `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/api/webhooks/transloadit`,
    fields: {
      attachmentId: opts.attachmentId,
    },
    steps: {
      store: {
        robot: '/cloudflare/store',
        use: ':original',
        credentials: auth.r2Credentials,
        path: `attachments/${opts.userId}/${opts.attachmentId}/\${file.url_name}`,
      },
    },
  };

  const { params, signature } = client.calcSignature(parsed, 'sha384');
  return { params, signature, parsed };
}

/**
 * Verify a Transloadit assembly notification signature over the verbatim
 * `transloadit` form field. Supports `algo:hex` (preferred) and legacy bare hex (sha1).
 */
export function verifyTransloaditWebhookSignature(
  payload: string,
  signatureHeader: string | null | undefined,
  authSecret = env.TRANSLOADIT_AUTH_SECRET,
): boolean {
  if (!authSecret || !signatureHeader) return false;
  const received = signatureHeader.trim();
  if (!received) return false;

  const sep = received.indexOf(':');
  const algo = sep === -1 ? 'sha1' : received.slice(0, sep).toLowerCase();
  const expectedHex = sep === -1 ? received : received.slice(sep + 1);

  try {
    const calculated = createHmac(algo, authSecret)
      .update(Buffer.from(payload, 'utf-8'))
      .digest('hex');
    const a = Buffer.from(calculated, 'utf-8');
    const b = Buffer.from(expectedHex, 'utf-8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
