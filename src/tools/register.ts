import { registerTool } from './registry';
import { cropImageTool } from './magica/crop-image';
import { gptImage2Tool } from './magica/gpt-image-2';
import { mergeVideosTool } from './magica/merge-videos';

let registered = false;

/** Idempotent bootstrap — register Magica node tools once per process. */
export function registerAllTools(): void {
  if (registered) return;
  registerTool(cropImageTool);
  registerTool(gptImage2Tool);
  registerTool(mergeVideosTool);
  registered = true;
}

/** Test helper — allow re-registration after clearTools(). */
export function resetToolRegistration(): void {
  registered = false;
}

// Side-effect import for callers that only need `import '@/tools/register'`.
registerAllTools();
