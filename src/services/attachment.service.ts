import { AppError } from '@/lib/errors';
import { instantToIso } from '@/lib/cursor';
import { ChatRepository } from '@/repositories/chat.repository';
import { AttachmentRepository } from '@/repositories/attachment.repository';
import {
  createDirectUploadSignature,
  verifyTransloaditWebhookSignature,
} from '@/providers/transloadit';

export type CreateAttachmentInput = {
  userId: string;
  chatId: string;
  originalName: string;
  mimeType: string;
  sizeBytes?: number;
};

function serializeAttachment(row: {
  id: string;
  userId: string;
  chatId: string;
  messageId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  storageProvider: string | null;
  storageKey: string | null;
  resultUrl: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}) {
  return {
    id: row.id,
    userId: row.userId,
    chatId: row.chatId,
    messageId: row.messageId,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    storageProvider: row.storageProvider,
    storageKey: row.storageKey,
    resultUrl: row.resultUrl,
    createdAt: instantToIso(row.createdAt),
    updatedAt: instantToIso(row.updatedAt),
  };
}

function pickStoreResult(assembly: Record<string, unknown>): {
  url: string;
  sizeBytes: number;
  mimeType?: string;
  storageKey?: string;
} | null {
  const results = assembly.results;
  if (!results || typeof results !== 'object') return null;

  const byStep = results as Record<string, unknown>;
  const candidates = [
    ...(Array.isArray(byStep.store) ? byStep.store : []),
    ...(Array.isArray(byStep[':original']) ? byStep[':original'] : []),
  ];

  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue;
    const file = raw as Record<string, unknown>;
    const url =
      (typeof file.ssl_url === 'string' && file.ssl_url) ||
      (typeof file.url === 'string' && file.url) ||
      null;
    if (!url) continue;
    const sizeBytes =
      typeof file.size === 'number'
        ? file.size
        : typeof file.bytes === 'number'
          ? file.bytes
          : 0;
    const mimeType =
      typeof file.mime === 'string'
        ? file.mime
        : typeof file.type === 'string'
          ? file.type
          : undefined;
    const storageKey =
      typeof file.key === 'string'
        ? file.key
        : typeof file.path === 'string'
          ? file.path
          : undefined;
    return { url, sizeBytes, mimeType, storageKey };
  }
  return null;
}

function assertSafeAssemblyUrl(assemblyUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(assemblyUrl);
  } catch {
    throw AppError.validation('Invalid assemblyUrl');
  }
  if (parsed.protocol !== 'https:') {
    throw AppError.validation('assemblyUrl must be https');
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'api2.transloadit.com' && !host.endsWith('.transloadit.com')) {
    throw AppError.validation('assemblyUrl host not allowed');
  }
}

/**
 * Shared completion path for Transloadit webhooks and client-driven reconcile.
 */
export async function applyAssembly(assembly: Record<string, unknown>): Promise<
  | { ok: true; ignored: true }
  | { ok: true; failed: true; attachmentId: string }
  | { ok: true; attachmentId: string }
> {
  const fields =
    assembly.fields && typeof assembly.fields === 'object'
      ? (assembly.fields as Record<string, unknown>)
      : {};
  const attachmentId =
    typeof fields.attachmentId === 'string' ? fields.attachmentId : null;
  if (!attachmentId) {
    return { ok: true, ignored: true as const };
  }

  const assemblyId =
    typeof assembly.assembly_id === 'string'
      ? assembly.assembly_id
      : typeof assembly.assemblyId === 'string'
        ? assembly.assemblyId
        : null;

  const ok =
    typeof assembly.ok === 'string'
      ? assembly.ok
      : typeof assembly.error === 'string'
        ? null
        : 'ASSEMBLY_COMPLETED';

  if (ok !== 'ASSEMBLY_COMPLETED') {
    await AttachmentRepository.markFailed(attachmentId, {
      error: assembly.error ?? assembly.message ?? ok,
      assemblyId,
    });
    return { ok: true, failed: true as const, attachmentId };
  }

  const file = pickStoreResult(assembly);
  if (!file) {
    await AttachmentRepository.markFailed(attachmentId, {
      error: 'No store result in assembly',
      assemblyId,
    });
    return { ok: true, failed: true as const, attachmentId };
  }

  const storageKey = file.storageKey ?? `attachments/unknown/${attachmentId}`;

  await AttachmentRepository.markCompleted({
    id: attachmentId,
    transloaditAssemblyId: assemblyId ?? attachmentId,
    storageProvider: 'r2',
    storageKey,
    resultUrl: file.url,
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
  });

  return { ok: true, attachmentId };
}

export const AttachmentService = {
  async createDirectUpload(input: CreateAttachmentInput) {
    const chat = await ChatRepository.findByIdForUser(input.chatId, input.userId);
    if (!chat) throw AppError.notFound();

    const attachment = await AttachmentRepository.create({
      userId: input.userId,
      chatId: input.chatId,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });

    const signed = createDirectUploadSignature({
      userId: input.userId,
      attachmentId: attachment.id,
    });

    return {
      attachment: serializeAttachment(attachment),
      upload: {
        params: signed.params,
        signature: signed.signature,
      },
    };
  },

  async getForUser(id: string, userId: string) {
    const row = await AttachmentRepository.findByIdForUser(id, userId);
    if (!row) throw AppError.notFound();
    return serializeAttachment(row);
  },

  /**
   * Resolve completed attachments for a chat message send.
   * Throws validation if any id is missing, wrong chat, or not COMPLETED.
   */
  async resolveForMessage(opts: {
    attachmentIds: string[];
    userId: string;
    chatId: string;
  }) {
    if (opts.attachmentIds.length === 0) return [];

    const unique = [...new Set(opts.attachmentIds)];
    const rows = await AttachmentRepository.findByIdsForUserChat({
      ids: unique,
      userId: opts.userId,
      chatId: opts.chatId,
    });

    if (rows.length !== unique.length) {
      throw AppError.validation('One or more attachments were not found');
    }

    for (const row of rows) {
      if (row.status !== 'COMPLETED') {
        throw AppError.validation(
          `Attachment ${row.id} is not ready (status=${row.status})`,
        );
      }
      if (!row.resultUrl) {
        throw AppError.validation(`Attachment ${row.id} has no result URL`);
      }
    }

    return rows;
  },

  async handleWebhook(opts: {
    transloaditPayload: string;
    signature: string | null;
  }) {
    if (
      !verifyTransloaditWebhookSignature(
        opts.transloaditPayload,
        opts.signature,
      )
    ) {
      throw AppError.unauthorized('Invalid Transloadit signature');
    }

    let assembly: Record<string, unknown>;
    try {
      assembly = JSON.parse(opts.transloaditPayload) as Record<string, unknown>;
    } catch {
      throw AppError.validation('Invalid Transloadit payload JSON');
    }

    return applyAssembly(assembly);
  },

  /**
   * Client fallback when notify_url webhooks cannot reach local/dev backends.
   * Fetches the assembly JSON from Transloadit and applies the same completion path.
   */
  async reconcile(opts: {
    id: string;
    userId: string;
    assemblyUrl: string;
  }) {
    const row = await AttachmentRepository.findByIdForUser(opts.id, opts.userId);
    if (!row) throw AppError.notFound();

    if (row.status === 'COMPLETED') {
      return serializeAttachment(row);
    }

    assertSafeAssemblyUrl(opts.assemblyUrl);

    let assembly: Record<string, unknown>;
    try {
      const response = await fetch(opts.assemblyUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw AppError.validation(
          `Failed to fetch assembly (${response.status})`,
        );
      }
      assembly = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (AppError.isAppError(error)) throw error;
      throw AppError.validation(
        error instanceof Error
          ? `Failed to fetch assembly: ${error.message}`
          : 'Failed to fetch assembly',
      );
    }

    const fields =
      assembly.fields && typeof assembly.fields === 'object'
        ? (assembly.fields as Record<string, unknown>)
        : {};
    const fieldAttachmentId =
      typeof fields.attachmentId === 'string' ? fields.attachmentId : null;

    if (fieldAttachmentId && fieldAttachmentId !== opts.id) {
      throw AppError.validation('Assembly attachmentId mismatch');
    }

    if (!fieldAttachmentId) {
      assembly = {
        ...assembly,
        fields: { ...fields, attachmentId: opts.id },
      };
    }

    const result = await applyAssembly(assembly);
    if ('ignored' in result && result.ignored) {
      throw AppError.validation('Assembly missing attachmentId');
    }

    return AttachmentService.getForUser(opts.id, opts.userId);
  },
};
