import { Webhook } from 'svix';
import { wait } from '@trigger.dev/sdk';
import { z } from 'zod';
import { env } from '@/lib/env';
import { now } from '@/lib/temporal';
import { db } from '@/prisma/db';
import { getNodeRun, type MagicaNodeRun } from '@/providers/magica';
import type { JsonValue } from '@prisma/orm-postgres/target/codec-types';

const MagicaWebhookPayloadSchema = z.object({
  type: z.string().optional(),
  runId: z.string().min(1),
  workflowId: z.string().optional(),
  data: z
    .object({
      status: z.string().optional(),
    })
    .passthrough()
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  error: z.unknown().optional(),
});

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

/**
 * Magica run lifecycle webhook (Svix-signed). Re-fetches the run (payload has
 * no output) and completes the Trigger waitpoint token.
 */
export async function POST(req: Request) {
  const secret = env.MAGICA_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return new Response('MAGICA_WEBHOOK_SIGNING_SECRET is not configured', {
      status: 500,
    });
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing svix headers', { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(secret);

  let raw: unknown;
  try {
    raw = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  const parsed = MagicaWebhookPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return new Response('Invalid payload', { status: 400 });
  }

  const payload = parsed.data;
  const metadata = payload.metadata ?? {};
  const waitpointTokenId =
    typeof metadata.waitpointTokenId === 'string'
      ? metadata.waitpointTokenId
      : null;

  if (!waitpointTokenId) {
    return new Response('ok', { status: 200 });
  }

  let run: MagicaNodeRun;
  try {
    run = await getNodeRun(payload.runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch run';
    return new Response(message, { status: 502 });
  }

  await wait.completeToken(waitpointTokenId, run);

  await db.orm.public.Waitpoint.where({ token: waitpointTokenId }).update({
    status: 'RESUMED',
    response: asJson(run),
    resumedAt: now(),
    updatedAt: now(),
  });

  return new Response('ok', { status: 200 });
}
