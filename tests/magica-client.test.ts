import { afterEach, describe, expect, it, vi } from 'vitest';
import { MagicaError } from '@/providers/magica/errors';
import { toAppCredits, toDecimalString, MICROCREDITS_PER_CREDIT } from '@/providers/magica/credits';
import { runNode, getNodeRun } from '@/providers/magica/nodes';
import { estimateCredits } from '@/providers/magica/pricing';

/**
 * Magica HTTP is stubbed with `vi.stubGlobal('fetch', ...)` (same pattern as
 * provider-adapter tests — MSW hangs under this vitest setup).
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('toAppCredits', () => {
  it('converts microcredits to fractional app credits with no minimum', () => {
    // crop_image ≈ 5_000 microcredits → 0.005 app credits at markup 1
    expect(toAppCredits(5_000)).toBe(0.005);
    expect(toAppCredits(MICROCREDITS_PER_CREDIT - 1)).toBe(0.999999);
    expect(toAppCredits(MICROCREDITS_PER_CREDIT)).toBe(1);
    expect(toAppCredits(MICROCREDITS_PER_CREDIT + 1)).toBe(1.000001);
    expect(toAppCredits(0)).toBe(0);
  });
});

describe('toDecimalString', () => {
  it('emits canonical numeric text for Decimal columns', () => {
    expect(toDecimalString(0.005)).toBe('0.005');
    expect(toDecimalString(-0.005)).toBe('-0.005');
    expect(toDecimalString(1)).toBe('1');
    expect(toDecimalString(0)).toBe('0');
  });
});

describe('runNode / getNodeRun', () => {
  it('parses 202 Accepted { runId }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ runId: 'run_abc' }), { status: 202 }),
      ),
    );

    await expect(
      runNode({
        nodeType: 'crop_image',
        input: { image_url: 'https://example.com/a.png' },
      }),
    ).resolves.toEqual({ runId: 'run_abc' });
  });

  it('maps 403 to insufficient_provider_credits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'no credits' }), { status: 403 }),
      ),
    );

    await expect(
      runNode({
        nodeType: 'crop_image',
        input: { image_url: 'https://example.com/a.png' },
      }),
    ).rejects.toMatchObject({
      name: 'MagicaError',
      code: 'insufficient_provider_credits',
      status: 403,
      retryable: false,
    } satisfies Partial<MagicaError>);
  });

  it('polls getNodeRun to a terminal COMPLETED payload', async () => {
    const completed = {
      id: 'run_1',
      nodeType: 'crop_image',
      status: 'COMPLETED',
      output: { image_url: ['https://cdn.example.com/out.png'] },
      creditUsed: 5_000,
      createdAt: '2026-09-04T00:00:00.000Z',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(completed), { status: 200 })),
    );

    await expect(getNodeRun('run_1')).resolves.toMatchObject({
      id: 'run_1',
      status: 'COMPLETED',
      creditUsed: 5_000,
    });
  });
});

describe('estimateCredits', () => {
  it('sums microcredits from estimates array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ estimates: [{ microcredits: 5_000 }, { microcredits: 1_000 }] }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      estimateCredits([{ type: 'crop_image', data: { image_url: 'https://x.test/a.png' } }]),
    ).resolves.toEqual({
      microcredits: 6_000,
      estimates: [{ microcredits: 5_000 }, { microcredits: 1_000 }],
    });
  });
});
