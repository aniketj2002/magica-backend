import { describe, expect, it } from 'vitest';
import { deriveChatTitle } from '@/lib/chatTitle';

describe('deriveChatTitle', () => {
  it('returns trimmed short text', () => {
    expect(deriveChatTitle('  crop this image  ')).toBe('crop this image');
  });

  it('truncates long text with ellipsis', () => {
    const long = 'a'.repeat(80);
    const title = deriveChatTitle(long);
    expect(title.length).toBe(60);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back when empty', () => {
    expect(deriveChatTitle('   ')).toBe('New chat');
  });
});
