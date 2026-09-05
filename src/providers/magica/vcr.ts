import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';

type MagicaVcrRequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
};

export type MagicaVcrMode = 'off' | 'record' | 'mock';

export type MagicaVcrStepOp =
  | 'estimate-credits'
  | 'run'
  | 'get-run'
  | 'other';

export type MagicaVcrStep = {
  op: MagicaVcrStepOp;
  method: string;
  path: string;
  requestBody?: unknown;
  status: number;
  responseBody: unknown;
  recordedAt: string;
};

export type MagicaVcrFixture = {
  version: 1;
  fingerprint: string;
  recordedAt: string;
  updatedAt: string;
  chain?: {
    nodeType: string;
    subModelId: string | null;
    input: unknown;
  };
  steps: MagicaVcrStep[];
};

const FIXTURE_VERSION = 1 as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function fingerprintOf(value: unknown): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, 16);
}

/** Same shape for estimate nodes and run requests so they share a fixture. */
export function chainFingerprint(nodes: Array<{
  type: string;
  data?: Record<string, unknown>;
  subModelId?: string | null;
}>): string {
  return fingerprintOf(
    nodes.map((n) => ({
      type: n.type,
      data: n.data ?? {},
      subModelId: n.subModelId ?? null,
    })),
  );
}

export function getMagicaVcrMode(): MagicaVcrMode {
  const raw = (env.MAGICA_VCR_MODE ?? 'off').toLowerCase();
  if (raw === 'record' || raw === 'mock' || raw === 'off') return raw;
  return 'off';
}

export function isMagicaVcrMock(): boolean {
  return getMagicaVcrMode() === 'mock';
}

export function isMagicaVcrRecord(): boolean {
  return getMagicaVcrMode() === 'record';
}

function vcrDir(): string {
  const configured = env.MAGICA_VCR_DIR?.trim();
  if (configured) {
    return configured.startsWith('/')
      ? configured
      : join(process.cwd(), configured);
  }
  return join(process.cwd(), 'fixtures', 'magica');
}

function ensureDir(): string {
  const dir = vcrDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fixturePath(fingerprint: string): string {
  return join(ensureDir(), `${fingerprint}.json`);
}

function readFixtureFile(path: string): MagicaVcrFixture | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as MagicaVcrFixture;
    if (raw?.version !== FIXTURE_VERSION || !raw.fingerprint) return null;
    return raw;
  } catch {
    return null;
  }
}

function loadFixture(fingerprint: string): MagicaVcrFixture | null {
  return readFixtureFile(fixturePath(fingerprint));
}

function listFixtures(): MagicaVcrFixture[] {
  const dir = vcrDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
    .map((name) => readFixtureFile(join(dir, name)))
    .filter((f): f is MagicaVcrFixture => f !== null);
}

function writeFixture(fixture: MagicaVcrFixture): void {
  const path = fixturePath(fixture.fingerprint);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  log.info('magica.vcr.wrote', {
    fingerprint: fixture.fingerprint,
    path,
    steps: fixture.steps.length,
  });
}

function classifyOp(method: string, path: string): MagicaVcrStepOp {
  if (path.includes('/estimate-credits')) return 'estimate-credits';
  if (/\/v1\/nodes\/[^/]+\/run(?:\?|$)/.test(path) && method === 'POST') {
    return 'run';
  }
  if (/\/v1\/nodes\/runs\/[^/?]+/.test(path) && method === 'GET') {
    return 'get-run';
  }
  return 'other';
}

function extractNodeTypeFromRunPath(path: string): string | null {
  const match = path.match(/\/v1\/nodes\/([^/?]+)\/run(?:\?|$)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function extractRunIdFromPath(path: string): string | null {
  const match = path.match(/\/v1\/nodes\/runs\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function fingerprintForRequest(
  method: string,
  path: string,
  body: unknown,
): string | null {
  const op = classifyOp(method, path);
  if (op === 'estimate-credits') {
    const nodes = (body as { nodes?: unknown } | null)?.nodes;
    if (!Array.isArray(nodes) || nodes.length === 0) return null;
    return chainFingerprint(
      nodes as Array<{
        type: string;
        data?: Record<string, unknown>;
        subModelId?: string | null;
      }>,
    );
  }
  if (op === 'run') {
    const nodeType = extractNodeTypeFromRunPath(path);
    if (!nodeType) return null;
    const record = (body ?? {}) as {
      input?: Record<string, unknown>;
      subModelId?: string;
    };
    return chainFingerprint([
      {
        type: nodeType,
        data: record.input ?? {},
        subModelId: record.subModelId ?? null,
      },
    ]);
  }
  return null;
}

function findFixtureByRunId(runId: string): MagicaVcrFixture | null {
  for (const fixture of listFixtures()) {
    for (const step of fixture.steps) {
      if (step.op === 'run') {
        const accepted = step.responseBody as { runId?: string } | null;
        if (accepted?.runId === runId) return fixture;
      }
      if (step.op === 'get-run') {
        const run = step.responseBody as { id?: string } | null;
        if (run?.id === runId) return fixture;
      }
    }
  }
  return null;
}

function findStep(
  fixture: MagicaVcrFixture,
  op: MagicaVcrStepOp,
): MagicaVcrStep | undefined {
  if (op === 'get-run') {
    // Prefer terminal get-run, else last recorded.
    const gets = fixture.steps.filter((s) => s.op === 'get-run');
    const terminal = [...gets]
      .reverse()
      .find((s) => {
        const status = (s.responseBody as { status?: string } | null)?.status;
        return (
          status === 'COMPLETED' ||
          status === 'FAILED' ||
          status === 'CANCELED'
        );
      });
    return terminal ?? gets[gets.length - 1];
  }
  return [...fixture.steps].reverse().find((s) => s.op === op);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Magica-VCR': 'mock',
    },
  });
}

/**
 * Serve a recorded Magica HTTP exchange. Throws if no matching fixture/step.
 */
export function mockMagicaResponse(
  path: string,
  options: MagicaVcrRequestOptions = {},
): Response {
  const method = options.method ?? 'GET';
  const op = classifyOp(method, path);
  const body = options.body;

  let fixture: MagicaVcrFixture | null = null;
  let step: MagicaVcrStep | undefined;

  if (op === 'get-run') {
    const runId = extractRunIdFromPath(path);
    if (!runId) {
      throw new Error(`Magica VCR mock: cannot parse run id from ${path}`);
    }
    fixture = findFixtureByRunId(runId);
    step = fixture ? findStep(fixture, 'get-run') : undefined;
  } else {
    const fingerprint = fingerprintForRequest(method, path, body);
    if (!fingerprint) {
      throw new Error(
        `Magica VCR mock: cannot fingerprint ${method} ${path}; record a fixture first`,
      );
    }
    fixture = loadFixture(fingerprint);
    step = fixture ? findStep(fixture, op) : undefined;

    // Fall back to any step with matching method+path if op-specific missing.
    if (!step && fixture) {
      step = fixture.steps.find(
        (s) => s.method === method && s.path.split('?')[0] === path.split('?')[0],
      );
    }
  }

  if (!fixture || !step) {
    throw new Error(
      `Magica VCR mock: no fixture for ${method} ${path} (op=${op}). ` +
        `Set MAGICA_VCR_MODE=record and make a live call first.`,
    );
  }

  log.info('magica.vcr.mock_hit', {
    fingerprint: fixture.fingerprint,
    op,
    method,
    path,
    status: step.status,
  });

  return jsonResponse(step.status, step.responseBody);
}

/**
 * Persist one Magica HTTP exchange into a fingerprint-keyed fixture chain.
 */
export function recordMagicaExchange(opts: {
  path: string;
  method: string;
  requestBody: unknown;
  status: number;
  responseBody: unknown;
}): void {
  const { path, method, requestBody, status, responseBody } = opts;
  const op = classifyOp(method, path);
  const now = new Date().toISOString();

  let fingerprint = fingerprintForRequest(method, path, requestBody);

  if (op === 'get-run') {
    const runId = extractRunIdFromPath(path);
    if (runId) {
      const existing = findFixtureByRunId(runId);
      if (existing) fingerprint = existing.fingerprint;
    }
  }

  if (!fingerprint) {
    // Unkeyed calls (catalog, balance, …) — store under path hash.
    fingerprint = fingerprintOf({ method, path, requestBody });
  }

  const existing = loadFixture(fingerprint);
  const fixture: MagicaVcrFixture = existing ?? {
    version: FIXTURE_VERSION,
    fingerprint,
    recordedAt: now,
    updatedAt: now,
    steps: [],
  };
  fixture.updatedAt = now;

  if (op === 'run') {
    const nodeType = extractNodeTypeFromRunPath(path);
    const record = (requestBody ?? {}) as {
      input?: unknown;
      subModelId?: string;
    };
    if (nodeType) {
      fixture.chain = {
        nodeType,
        subModelId: record.subModelId ?? null,
        input: record.input ?? {},
      };
    }
  }

  const step: MagicaVcrStep = {
    op,
    method,
    path,
    ...(requestBody !== undefined ? { requestBody } : {}),
    status,
    responseBody,
    recordedAt: now,
  };

  if (op === 'get-run') {
    // Keep a single get-run slot; overwrite until terminal so fixtures stay small.
    const idx = fixture.steps.findIndex((s) => s.op === 'get-run');
    if (idx >= 0) fixture.steps[idx] = step;
    else fixture.steps.push(step);
  } else if (op === 'estimate-credits' || op === 'run') {
    const idx = fixture.steps.findIndex((s) => s.op === op);
    if (idx >= 0) fixture.steps[idx] = step;
    else fixture.steps.push(step);
  } else {
    fixture.steps.push(step);
  }

  writeFixture(fixture);
}

/** Strip webhook from run bodies so fingerprints stay stable across APP_PUBLIC_URL. */
export function bodyForVcrFingerprint(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { webhook: _webhook, ...rest } = body as Record<string, unknown>;
  return rest;
}
