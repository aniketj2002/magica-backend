import { magicaJson, mapMagicaHttpError, magicaFetch } from './client';
import {
  MagicaNodeRunSchema,
  MagicaRunAcceptedSchema,
  type MagicaNodeRun,
  type MagicaRunAccepted,
  type MagicaRunNodeInput,
} from './types';

export async function runNode(input: MagicaRunNodeInput): Promise<MagicaRunAccepted> {
  const body: Record<string, unknown> = { input: input.input };
  if (input.subModelId) body.subModelId = input.subModelId;
  if (input.webhook) body.webhook = input.webhook;

  const response = await magicaFetch(
    `/v1/nodes/${encodeURIComponent(input.nodeType)}/run`,
    { method: 'POST', body },
  );

  if (response.status !== 202 && !response.ok) {
    throw await mapMagicaHttpError(response);
  }

  const data: unknown = await response.json();
  return MagicaRunAcceptedSchema.parse(data);
}

export async function getNodeRun(runId: string): Promise<MagicaNodeRun> {
  return magicaJson(`/v1/nodes/runs/${encodeURIComponent(runId)}`, {}, (data) =>
    MagicaNodeRunSchema.parse(data),
  );
}
