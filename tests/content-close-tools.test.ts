import { describe, expect, it } from 'vitest';
import {
  closeOpenToolUses,
  parseContentBlocks,
  type ContentBlock,
} from '@/agent/content';

describe('closeOpenToolUses', () => {
  it('appends error results for tool_use blocks without a matching tool_result', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', text: 'planning' },
      {
        type: 'tool_use',
        id: 'call-1',
        name: 'gpt_image_2',
        input: { prompt: 'mountains' },
      },
      {
        type: 'tool_result',
        toolUseId: 'call-1',
        content: { error: 'tool_execution_error', message: 'no image_url' },
        isError: true,
      },
      {
        type: 'tool_use',
        id: 'call-2',
        name: 'gpt_image_2',
        input: { prompt: 'mountains' },
      },
      { type: 'text', text: "I'll create a landscape." },
    ];

    const closed = closeOpenToolUses(blocks, {
      content: { error: 'cancelled', message: 'Run cancelled' },
      isError: true,
    });

    expect(closed).toEqual([
      ...blocks,
      {
        type: 'tool_result',
        toolUseId: 'call-2',
        content: { error: 'cancelled', message: 'Run cancelled' },
        isError: true,
      },
    ]);
  });

  it('is a no-op when every tool_use already has a result', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'call-1',
        name: 'crop_image',
        input: {},
      },
      {
        type: 'tool_result',
        toolUseId: 'call-1',
        content: { image_url: ['https://x.test/a.png'] },
      },
    ];

    expect(
      closeOpenToolUses(blocks, {
        content: { error: 'cancelled' },
        isError: true,
      }),
    ).toBe(blocks);
  });

  it('parseContentBlocks still accepts closed tool results', () => {
    const closed = closeOpenToolUses(
      [
        {
          type: 'tool_use',
          id: 'call-x',
          name: 'gpt_image_2',
          input: {},
        },
      ],
      { content: { error: 'cancelled', message: 'Run cancelled' }, isError: true },
    );
    expect(parseContentBlocks(closed)).toEqual(closed);
  });
});
