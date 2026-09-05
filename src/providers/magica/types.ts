import { z } from 'zod';

export const MagicaNodeRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
]);

export type MagicaNodeRunStatus = z.infer<typeof MagicaNodeRunStatusSchema>;

export const MagicaRunAcceptedSchema = z.object({
  runId: z.string().min(1),
});

export type MagicaRunAccepted = z.infer<typeof MagicaRunAcceptedSchema>;

export const MagicaNodeRunSchema = z.object({
  id: z.string().min(1),
  nodeType: z.string().min(1),
  subModelId: z.string().nullable().optional(),
  status: MagicaNodeRunStatusSchema,
  input: z.unknown().optional(),
  output: z.unknown().nullable().optional(),
  error: z.string().nullable().optional(),
  userMessage: z.string().nullable().optional(),
  creditUsed: z.number().optional(),
  source: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type MagicaNodeRun = z.infer<typeof MagicaNodeRunSchema>;

export const MagicaEstimateCreditsResponseSchema = z.object({
  estimates: z.array(
    z.object({
      microcredits: z.number(),
    }),
  ),
});

export type MagicaEstimateCreditsResponse = z.infer<
  typeof MagicaEstimateCreditsResponseSchema
>;

export const MagicaCreditBalanceSchema = z.object({
  availableBalance: z.number(),
  formatted: z.string().optional(),
  hasActiveSubscription: z.boolean().optional(),
  isOrganization: z.boolean().optional(),
});

export type MagicaCreditBalance = z.infer<typeof MagicaCreditBalanceSchema>;

/** Loosely typed — Magica pricing payloads vary by model strategy. */
export const MagicaModelPricingSchema = z
  .object({
    modelId: z.string().optional(),
    estimatedCost: z.string().optional(),
    costSummary: z.string().optional(),
    pricingApproach: z.string().optional(),
    pricingDetails: z.unknown().optional(),
    note: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type MagicaModelPricing = z.infer<typeof MagicaModelPricingSchema>;

export const MagicaCatalogSchema = z
  .object({
    version: z.number(),
    generatedAt: z.string(),
    models: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export type MagicaCatalog = z.infer<typeof MagicaCatalogSchema>;

export type MagicaWebhookConfig = {
  url: string;
  events?: Array<'run.started' | 'run.completed' | 'run.failed'>;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
};

export type MagicaEstimateNode = {
  type: string;
  data?: Record<string, unknown>;
  subModelId?: string;
};

export type MagicaRunNodeInput = {
  nodeType: string;
  input: Record<string, unknown>;
  subModelId?: string;
  webhook?: MagicaWebhookConfig;
};
