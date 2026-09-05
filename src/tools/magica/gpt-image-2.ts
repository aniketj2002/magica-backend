import { z } from 'zod';
import { createMagicaNodeTool, extractUrlArray } from './node-tool';

const GptImage2InputSchema = z.object({
  prompt: z.string().min(1).describe('Text prompt for generation or edit'),
  uploadedImages: z
    .array(z.string().url())
    .min(1)
    .max(10)
    .optional()
    .describe('Source images for edit mode (1–10). Omit for text-to-image.'),
  mask: z.string().url().optional().describe('Optional mask URL for edit mode'),
  size: z.string().optional(),
  quality: z.string().optional(),
  background: z.string().optional(),
  n: z.number().int().min(1).max(4).optional(),
  output_format: z.string().optional(),
  output_compression: z.number().optional(),
});

const GptImage2OutputSchema = z.object({
  image_url: z.array(z.string().url()).min(1),
});

export type GptImage2Input = z.infer<typeof GptImage2InputSchema>;
export type GptImage2Output = z.infer<typeof GptImage2OutputSchema>;

export const gptImage2Tool = createMagicaNodeTool({
  name: 'gpt_image_2',
  description:
    'Generate or edit images with GPT Image 2. Pass uploadedImages to edit; omit for text-to-image.',
  inputSchema: GptImage2InputSchema,
  outputSchema: GptImage2OutputSchema,
  pricing: {
    provider: 'magica',
    nodeType: 'gpt_image_2',
    modelId: 'gpt_image_2',
  },
  assetType: 'IMAGE',
  outputUrlKey: 'image_url',
  resolveSubModelId: (input) =>
    input.uploadedImages && input.uploadedImages.length > 0
      ? 'gpt-image-2-edit'
      : 'gpt-image-2-text',
  toNodeInput: (input) => {
    const data: Record<string, unknown> = { prompt: input.prompt };
    if (input.uploadedImages?.length) data.uploadedImages = input.uploadedImages;
    if (input.mask) data.mask = input.mask;
    if (input.size !== undefined) data.size = input.size;
    if (input.quality !== undefined) data.quality = input.quality;
    if (input.background !== undefined) data.background = input.background;
    if (input.n !== undefined) data.n = input.n;
    if (input.output_format !== undefined) data.output_format = input.output_format;
    if (input.output_compression !== undefined) {
      data.output_compression = input.output_compression;
    }
    return data;
  },
  mapOutput: (run) => {
    const image_url = extractUrlArray(run.output, 'image_url');
    if (image_url.length === 0) {
      throw new Error('gpt_image_2 completed without image_url output');
    }
    return { image_url };
  },
});
