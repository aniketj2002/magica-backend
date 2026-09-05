import { z } from 'zod';
import { createMagicaNodeTool, extractUrlArray } from './node-tool';

const CropImageInputSchema = z.object({
  image_url: z.string().url().describe('Source image URL to crop'),
  x_percent: z.number().min(0).max(100).optional(),
  y_percent: z.number().min(0).max(100).optional(),
  width_percent: z.number().min(0).max(100).optional(),
  height_percent: z.number().min(0).max(100).optional(),
  x_px: z.number().int().nonnegative().optional(),
  y_px: z.number().int().nonnegative().optional(),
  width_px: z.number().int().positive().optional(),
  height_px: z.number().int().positive().optional(),
});

const CropImageOutputSchema = z.object({
  image_url: z.array(z.string().url()).min(1),
});

export type CropImageInput = z.infer<typeof CropImageInputSchema>;
export type CropImageOutput = z.infer<typeof CropImageOutputSchema>;

export const cropImageTool = createMagicaNodeTool({
  name: 'crop_image',
  description:
    'Crop an image by percent or pixel box. Returns durable image URL(s).',
  inputSchema: CropImageInputSchema,
  outputSchema: CropImageOutputSchema,
  pricing: {
    provider: 'magica',
    nodeType: 'crop_image',
    modelId: 'crop_image',
  },
  assetType: 'IMAGE',
  outputUrlKey: 'image_url',
  toNodeInput: (input) => {
    const data: Record<string, unknown> = { image_url: input.image_url };
    if (input.x_percent !== undefined) data.x_percent = input.x_percent;
    if (input.y_percent !== undefined) data.y_percent = input.y_percent;
    if (input.width_percent !== undefined) data.width_percent = input.width_percent;
    if (input.height_percent !== undefined) data.height_percent = input.height_percent;
    if (input.x_px !== undefined) data.x_px = input.x_px;
    if (input.y_px !== undefined) data.y_px = input.y_px;
    if (input.width_px !== undefined) data.width_px = input.width_px;
    if (input.height_px !== undefined) data.height_px = input.height_px;
    return data;
  },
  mapOutput: (run) => {
    const image_url = extractUrlArray(run.output, 'image_url');
    if (image_url.length === 0) {
      throw new Error('crop_image completed without image_url output');
    }
    return { image_url };
  },
});
