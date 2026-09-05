import { z } from 'zod';
import { createMagicaNodeTool, extractUrlArray } from './node-tool';

const MergeVideosInputSchema = z.object({
  video_urls: z
    .array(z.string().url())
    .min(2)
    .max(100)
    .describe('Ordered list of video URLs to concatenate (2–100)'),
  transition: z
    .enum(['none', 'fade', 'dissolve'])
    .default('none')
    .describe('Transition between clips'),
});

const MergeVideosOutputSchema = z.object({
  video_url: z.array(z.string().url()).min(1),
});

export type MergeVideosInput = z.infer<typeof MergeVideosInputSchema>;
export type MergeVideosOutput = z.infer<typeof MergeVideosOutputSchema>;

export const mergeVideosTool = createMagicaNodeTool({
  name: 'merge_videos',
  description:
    'Concatenate 2–100 videos with an optional transition. Returns durable video URL(s).',
  inputSchema: MergeVideosInputSchema,
  outputSchema: MergeVideosOutputSchema,
  pricing: {
    provider: 'magica',
    nodeType: 'merge_videos',
    modelId: 'merge_videos',
  },
  assetType: 'VIDEO',
  outputUrlKey: 'video_url',
  toNodeInput: (input) => ({
    video_urls: input.video_urls,
    transition: input.transition,
  }),
  mapOutput: (run) => {
    const video_url = extractUrlArray(run.output, 'video_url');
    if (video_url.length === 0) {
      throw new Error('merge_videos completed without video_url output');
    }
    return { video_url };
  },
});
