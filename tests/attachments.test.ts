import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDirectUploadSignature,
  verifyTransloaditWebhookSignature,
} from '@/providers/transloadit/signature';
import { AppError } from '@/lib/errors';

const {
  mockFindById,
  mockFindByIdForUser,
  mockMarkCompleted,
  mockMarkFailed,
} = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockFindByIdForUser: vi.fn(),
  mockMarkCompleted: vi.fn(async () => ({
    id: 'att-1',
    userId: 'user-1',
    chatId: 'chat-1',
    messageId: null,
    originalName: 'a.png',
    mimeType: 'image/png',
    sizeBytes: 1234,
    status: 'COMPLETED',
    storageProvider: 'r2',
    storageKey: 'attachments/user-1/att-1/a.png',
    resultUrl: 'https://media.test.local/attachments/user-1/att-1/a.png',
    createdAt: new Date('2026-09-04T12:00:00.000Z'),
    updatedAt: new Date('2026-09-04T12:00:00.000Z'),
  })),
  mockMarkFailed: vi.fn(async () => ({
    id: 'att-1',
    status: 'FAILED',
  })),
}));

vi.mock('@/repositories/attachment.repository', () => ({
  AttachmentRepository: {
    findById: mockFindById,
    findByIdForUser: mockFindByIdForUser,
    markCompleted: mockMarkCompleted,
    markFailed: mockMarkFailed,
  },
}));

import { AttachmentService } from '@/services/attachment.service';

const AUTH_SECRET = process.env.TRANSLOADIT_AUTH_SECRET!;

function signPayload(payload: string, algo: 'sha384' | 'sha1' = 'sha384'): string {
  const hex = createHmac(algo, AUTH_SECRET).update(payload, 'utf-8').digest('hex');
  return `${algo}:${hex}`;
}

describe('createDirectUploadSignature', () => {
  it('is deterministic for the same inputs and expiry', () => {
    const expires = '2026-09-04T12:00:00.000Z';
    const a = createDirectUploadSignature({
      userId: 'user-1',
      attachmentId: 'att-1',
      expires,
    });
    const b = createDirectUploadSignature({
      userId: 'user-1',
      attachmentId: 'att-1',
      expires,
    });

    expect(a.signature).toBe(b.signature);
    expect(a.params).toBe(b.params);
    expect(a.signature.startsWith('sha384:')).toBe(true);
    expect(a.parsed.notify_url).toContain('/api/webhooks/transloadit');
    expect(a.parsed.steps.store.robot).toBe('/cloudflare/store');
    expect(a.parsed.steps.store.result).toBe(true);
    expect(a.parsed.steps.store.path).toContain('attachments/user-1/att-1/');
  });

  it('changes signature when attachmentId changes', () => {
    const expires = '2026-09-04T12:00:00.000Z';
    const a = createDirectUploadSignature({
      userId: 'user-1',
      attachmentId: 'att-1',
      expires,
    });
    const b = createDirectUploadSignature({
      userId: 'user-1',
      attachmentId: 'att-2',
      expires,
    });
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('verifyTransloaditWebhookSignature', () => {
  const payload = JSON.stringify({
    ok: 'ASSEMBLY_COMPLETED',
    fields: { attachmentId: 'att-1' },
  });

  it('accepts a valid sha384 signature', () => {
    expect(
      verifyTransloaditWebhookSignature(payload, signPayload(payload, 'sha384')),
    ).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const signature = signPayload(payload, 'sha384');
    expect(
      verifyTransloaditWebhookSignature(payload + 'x', signature),
    ).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifyTransloaditWebhookSignature(payload, null)).toBe(false);
  });
});

describe('AttachmentService.handleWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({
      id: 'att-1',
      status: 'PENDING',
    });
  });

  it('marks attachment COMPLETED on a valid signed assembly', async () => {
    const assembly = {
      ok: 'ASSEMBLY_COMPLETED',
      assembly_id: 'asm_1',
      fields: { attachmentId: 'att-1' },
      results: {
        store: [
          {
            ssl_url: 'https://media.test.local/attachments/user-1/att-1/a.png',
            size: 1234,
            mime: 'image/png',
            path: 'attachments/user-1/att-1/a.png',
          },
        ],
      },
    };
    const payload = JSON.stringify(assembly);
    const signature = signPayload(payload);

    const result = await AttachmentService.handleWebhook({
      transloaditPayload: payload,
      signature,
    });

    expect(result).toMatchObject({ ok: true, attachmentId: 'att-1' });
    expect(mockMarkCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'att-1',
        storageProvider: 'r2',
        resultUrl: 'https://media.test.local/attachments/user-1/att-1/a.png',
        sizeBytes: 1234,
      }),
    );
  });

  it('rewrites Transloadit private R2 URLs to R2_PUBLIC_BASE_URL', async () => {
    const assembly = {
      ok: 'ASSEMBLY_COMPLETED',
      assembly_id: 'asm_1',
      fields: { attachmentId: 'att-1' },
      results: {
        store: [
          {
            ssl_url:
              'https://magica-media-vitest.r2_account_vitest.r2.cloudflarestorage.com/attachments/user-1/att-1/a.png',
            size: 1234,
            mime: 'image/png',
            path: 'attachments/user-1/att-1/a.png',
          },
        ],
      },
    };
    const payload = JSON.stringify(assembly);
    const signature = signPayload(payload);

    await AttachmentService.handleWebhook({
      transloaditPayload: payload,
      signature,
    });

    expect(mockMarkCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: 'attachments/user-1/att-1/a.png',
        resultUrl: 'https://media.test.local/attachments/user-1/att-1/a.png',
      }),
    );
  });

  it('derives storageKey from R2 ssl_url when key/path are missing', async () => {
    const assembly = {
      ok: 'ASSEMBLY_COMPLETED',
      assembly_id: 'asm_1',
      fields: { attachmentId: 'att-1' },
      results: {
        store: [
          {
            ssl_url:
              'https://magica-media-vitest.r2_account_vitest.r2.cloudflarestorage.com/attachments/user-1/att-1/20260903_153121.jpg',
            size: 1234,
            mime: 'image/jpeg',
          },
        ],
      },
    };
    const payload = JSON.stringify(assembly);
    const signature = signPayload(payload);

    await AttachmentService.handleWebhook({
      transloaditPayload: payload,
      signature,
    });

    expect(mockMarkCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        storageKey: 'attachments/user-1/att-1/20260903_153121.jpg',
        resultUrl:
          'https://media.test.local/attachments/user-1/att-1/20260903_153121.jpg',
      }),
    );
    expect(mockMarkCompleted.mock.calls[0][0].resultUrl).not.toContain(
      '/attachments/unknown/',
    );
  });

  it('fails instead of inventing attachments/unknown keys', async () => {
    const assembly = {
      ok: 'ASSEMBLY_COMPLETED',
      assembly_id: 'asm_1',
      fields: { attachmentId: 'att-1' },
      results: {
        store: [
          {
            // Temp Transloadit CDN URL — not an R2 object key
            ssl_url: 'https://tmp.transloadit.com/files/abc123/a.png',
            size: 1234,
            mime: 'image/png',
          },
        ],
      },
    };
    const payload = JSON.stringify(assembly);
    const signature = signPayload(payload);

    const result = await AttachmentService.handleWebhook({
      transloaditPayload: payload,
      signature,
    });

    expect(result).toMatchObject({ ok: true, failed: true, attachmentId: 'att-1' });
    expect(mockMarkCompleted).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalled();
  });

  it('rejects an invalid signature with unauthorized', async () => {
    await expect(
      AttachmentService.handleWebhook({
        transloaditPayload: JSON.stringify({
          ok: 'ASSEMBLY_COMPLETED',
          fields: { attachmentId: 'att-1' },
        }),
        signature: 'sha384:deadbeef',
      }),
    ).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<AppError>);
    expect(mockMarkCompleted).not.toHaveBeenCalled();
  });
});

describe('AttachmentService.reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockFindByIdForUser.mockResolvedValue({
      id: 'att-1',
      userId: 'user-1',
      chatId: 'chat-1',
      messageId: null,
      originalName: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 0,
      status: 'PENDING',
      storageProvider: null,
      storageKey: null,
      resultUrl: null,
      createdAt: new Date('2026-09-04T12:00:00.000Z'),
      updatedAt: new Date('2026-09-04T12:00:00.000Z'),
    });
  });

  it('fetches assembly and marks COMPLETED', async () => {
    const assembly = {
      ok: 'ASSEMBLY_COMPLETED',
      assembly_id: 'asm_1',
      fields: { attachmentId: 'att-1' },
      results: {
        store: [
          {
            ssl_url: 'https://media.test.local/attachments/user-1/att-1/a.png',
            size: 1234,
            mime: 'image/png',
            path: 'attachments/user-1/att-1/a.png',
          },
        ],
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => assembly,
      })),
    );

    // After applyAssembly, getForUser is called again.
    mockFindByIdForUser
      .mockResolvedValueOnce({
        id: 'att-1',
        userId: 'user-1',
        chatId: 'chat-1',
        messageId: null,
        originalName: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 0,
        status: 'PENDING',
        storageProvider: null,
        storageKey: null,
        resultUrl: null,
        createdAt: new Date('2026-09-04T12:00:00.000Z'),
        updatedAt: new Date('2026-09-04T12:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'att-1',
        userId: 'user-1',
        chatId: 'chat-1',
        messageId: null,
        originalName: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 1234,
        status: 'COMPLETED',
        storageProvider: 'r2',
        storageKey: 'attachments/user-1/att-1/a.png',
        resultUrl: 'https://media.test.local/attachments/user-1/att-1/a.png',
        createdAt: new Date('2026-09-04T12:00:00.000Z'),
        updatedAt: new Date('2026-09-04T12:00:00.000Z'),
      });

    const result = await AttachmentService.reconcile({
      id: 'att-1',
      userId: 'user-1',
      assemblyUrl: 'https://api2.transloadit.com/assemblies/asm_1',
    });

    expect(result.status).toBe('COMPLETED');
    expect(mockMarkCompleted).toHaveBeenCalled();
  });

  it('rejects non-Transloadit assembly URLs', async () => {
    await expect(
      AttachmentService.reconcile({
        id: 'att-1',
        userId: 'user-1',
        assemblyUrl: 'https://evil.example/assemblies/asm_1',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(mockMarkCompleted).not.toHaveBeenCalled();
  });
});
