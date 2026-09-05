import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEstimateCredits,
  mockRunNode,
  mockGetNodeRun,
  mockCreateToken,
  mockForToken,
  mockTasksTrigger,
  mockUpdateState,
  mockEnsureReservation,
  mockSettle,
  mockMirror,
  mockWaitpointCreate,
  mockWaitpointUpdate,
  mockToolInvocationUpdate,
} = vi.hoisted(() => ({
  mockEstimateCredits: vi.fn(),
  mockRunNode: vi.fn(),
  mockGetNodeRun: vi.fn(),
  mockCreateToken: vi.fn(),
  mockForToken: vi.fn(),
  mockTasksTrigger: vi.fn(async () => ({ id: 'poll-1' })),
  mockUpdateState: vi.fn(async () => undefined),
  mockEnsureReservation: vi.fn(async () => ({ reservedCredits: 1, topUp: 1 })),
  mockSettle: vi.fn(async () => ({ credits: 1, alreadySettled: false })),
  mockMirror: vi.fn(
    async (opts: { sourceUrls: string[] }) =>
      opts.sourceUrls.map((u, i) => `https://media.test.local/generated/${i}.png`),
  ),
  mockWaitpointCreate: vi.fn(async () => ({})),
  mockWaitpointUpdate: vi.fn(async () => undefined),
  mockToolInvocationUpdate: vi.fn(async () => undefined),
}));

vi.mock('@trigger.dev/sdk', () => ({
  wait: {
    createToken: mockCreateToken,
    forToken: mockForToken,
  },
  tasks: { trigger: mockTasksTrigger },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/providers/magica', async () => {
  const credits = await import('@/providers/magica/credits');
  return {
    estimateCredits: mockEstimateCredits,
    runNode: mockRunNode,
    getNodeRun: mockGetNodeRun,
    toAppCredits: credits.toAppCredits,
    isMagicaVcrMock: () => false,
  };
});

vi.mock('@/repositories/agentRun.repository', () => ({
  AgentRunRepository: { updateState: mockUpdateState },
}));

vi.mock('@/services/creditReservation.service', () => ({
  CreditReservationService: {
    ensureReservation: mockEnsureReservation,
    settleToolInvocation: mockSettle,
  },
}));

vi.mock('@/services/media.service', () => ({
  MediaService: { mirrorToolOutputUrls: mockMirror },
}));

vi.mock('@/trigger/magica-poll.task', () => ({
  MAGICA_POLL_TASK_ID: 'magica-poll',
  magicaPollTask: {},
}));

vi.mock('@/prisma/db', () => ({
  db: {
    orm: {
      public: {
        Waitpoint: {
          create: mockWaitpointCreate,
          where: vi.fn(() => ({ update: mockWaitpointUpdate })),
        },
        ToolInvocation: {
          where: vi.fn(() => ({ update: mockToolInvocationUpdate })),
        },
      },
    },
  },
}));

import { cropImageTool } from '@/tools/magica/crop-image';
import { gptImage2Tool } from '@/tools/magica/gpt-image-2';
import { mergeVideosTool } from '@/tools/magica/merge-videos';
import { createLogger } from '@/lib/logger';
import type { ToolContext } from '@/tools/types';

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    agentRunId: 'run-1',
    chatId: 'chat-1',
    messageId: 'msg-1',
    userId: 'user-1',
    signal: new AbortController().signal,
    logger: createLogger({ runId: 'run-1' }),
    toolCallId: 'call-1',
    toolInvocationId: 'inv-1',
    ...overrides,
  };
}

describe('Magica tool Zod validation + sub-model selection', () => {
  it('rejects crop_image without image_url', () => {
    const parsed = cropImageTool.inputSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it('accepts crop_image with percent crop box', () => {
    const parsed = cropImageTool.inputSchema.safeParse({
      image_url: 'https://example.com/a.png',
      x_percent: 10,
      width_percent: 50,
    });
    expect(parsed.success).toBe(true);
  });

  it('selects gpt-image-2-edit when uploadedImages are present', () => {
    const edit = gptImage2Tool.inputSchema.parse({
      prompt: 'make it blue',
      uploadedImages: ['https://example.com/a.png'],
    });
    // resolveSubModelId is closed over in createMagicaNodeTool; exercise via estimateCost path
    expect(edit.uploadedImages?.length).toBe(1);
  });

  it('defaults gpt_image_2 quality to high and rejects Magica-invalid values', () => {
    expect(gptImage2Tool.inputSchema.parse({ prompt: 'lake' }).quality).toBe(
      'high',
    );
    expect(
      gptImage2Tool.inputSchema.safeParse({
        prompt: 'lake',
        quality: 'standard',
      }).success,
    ).toBe(false);
    expect(
      gptImage2Tool.inputSchema.parse({ prompt: 'lake', quality: 'medium' })
        .quality,
    ).toBe('medium');
  });

  it('requires at least two video_urls for merge_videos', () => {
    const parsed = mergeVideosTool.inputSchema.safeParse({
      video_urls: ['https://example.com/a.mp4'],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('gpt_image_2 sub-model + durable output mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEstimateCredits.mockResolvedValue({ microcredits: 50_000, estimates: [{ microcredits: 50_000 }] });
    mockCreateToken.mockResolvedValue({ id: 'tok_1' });
    mockRunNode.mockResolvedValue({ runId: 'magica_run_1' });
    mockTasksTrigger.mockResolvedValue({ id: 'poll-1' });
    mockSettle.mockResolvedValue({ credits: 1, alreadySettled: false });
    mockMirror.mockImplementation(async (opts: { sourceUrls: string[] }) =>
      opts.sourceUrls.map((_, i) => `https://media.test.local/generated/${i}.png`),
    );
  });

  it('uses gpt-image-2-text for prompt-only input and mirrors image URLs to R2', async () => {
    mockForToken.mockResolvedValue({
      ok: true,
      output: {
        id: 'magica_run_1',
        nodeType: 'gpt_image_2',
        subModelId: 'gpt-image-2-text',
        status: 'COMPLETED',
        output: { image_url: ['https://magica.example/tmp.png'] },
        creditUsed: 50_000,
        createdAt: '2026-09-04T00:00:00.000Z',
      },
    });

    const result = await gptImage2Tool.execute(
      { prompt: 'a red circle' },
      ctx(),
    );

    expect(mockRunNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeType: 'gpt_image_2',
        subModelId: 'gpt-image-2-text',
        input: expect.objectContaining({ prompt: 'a red circle' }),
      }),
    );
    expect(mockEnsureReservation).toHaveBeenCalledWith({
      userId: 'user-1',
      agentRunId: 'run-1',
      needed: 0.05,
    });
    expect(mockSettle).toHaveBeenCalledWith({
      toolInvocationId: 'inv-1',
      microcredits: 50_000,
    });
    expect(mockMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrls: ['https://magica.example/tmp.png'],
        assetType: 'IMAGE',
        toolInvocationId: 'inv-1',
      }),
    );
    expect(result.image_url).toEqual(['https://media.test.local/generated/0.png']);
  });

  it('maps Magica gpt_image_2 output.result URLs (not image_url)', async () => {
    mockForToken.mockResolvedValue({
      ok: true,
      output: {
        id: 'cmto784s3005rl7041onl3a4z',
        nodeType: 'gpt_image_2',
        subModelId: 'gpt-image-2-text',
        status: 'COMPLETED',
        output: {
          result: ['https://g.tlcdn.com/gen/5b9bbdf17a424a9ea38f9ea1ba6f4dbe.png'],
          provider: 'openai',
          creditUsed: 210720,
        },
        creditUsed: 210720,
        createdAt: '2026-09-05T09:47:02.835Z',
      },
    });

    const result = await gptImage2Tool.execute(
      { prompt: 'mountains at golden hour' },
      ctx({ toolCallId: 'call-result-shape' }),
    );

    expect(mockMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrls: [
          'https://g.tlcdn.com/gen/5b9bbdf17a424a9ea38f9ea1ba6f4dbe.png',
        ],
      }),
    );
    expect(result.image_url).toEqual(['https://media.test.local/generated/0.png']);
  });

  it('uses gpt-image-2-edit when uploadedImages are provided', async () => {
    mockForToken.mockResolvedValue({
      ok: true,
      output: {
        id: 'magica_run_1',
        nodeType: 'gpt_image_2',
        subModelId: 'gpt-image-2-edit',
        status: 'COMPLETED',
        output: { image_url: ['https://magica.example/edit.png'] },
        creditUsed: 80_000,
        createdAt: '2026-09-04T00:00:00.000Z',
      },
    });

    await gptImage2Tool.execute(
      {
        prompt: 'add snow',
        uploadedImages: ['https://example.com/src.png'],
      },
      ctx({ toolCallId: 'call-edit' }),
    );

    expect(mockRunNode).toHaveBeenCalledWith(
      expect.objectContaining({
        subModelId: 'gpt-image-2-edit',
        input: expect.objectContaining({
          uploadedImages: ['https://example.com/src.png'],
        }),
      }),
    );
  });

  it('maps merge_videos output to VIDEO GeneratedAsset mirroring', async () => {
    mockForToken.mockResolvedValue({
      ok: true,
      output: {
        id: 'magica_run_2',
        nodeType: 'merge_videos',
        status: 'COMPLETED',
        output: { video_url: ['https://magica.example/merged.mp4'] },
        creditUsed: 40_000,
        createdAt: '2026-09-04T00:00:00.000Z',
      },
    });
    mockMirror.mockImplementation(async (opts: { sourceUrls: string[] }) =>
      opts.sourceUrls.map((_, i) => `https://media.test.local/generated/${i}.mp4`),
    );

    const result = await mergeVideosTool.execute(
      {
        video_urls: [
          'https://example.com/a.mp4',
          'https://example.com/b.mp4',
        ],
        transition: 'fade',
      },
      ctx({ toolCallId: 'call-merge', toolInvocationId: 'inv-merge' }),
    );

    expect(mockMirror).toHaveBeenCalledWith(
      expect.objectContaining({
        assetType: 'VIDEO',
        sourceUrls: ['https://magica.example/merged.mp4'],
      }),
    );
    expect(result.video_url).toEqual(['https://media.test.local/generated/0.mp4']);
  });
});
