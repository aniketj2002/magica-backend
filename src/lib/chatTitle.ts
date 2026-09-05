/** Derive a sidebar chat title from the first user message text. */
export function deriveChatTitle(text: string, maxLen = 60): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'New chat';
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxLen - 1))}…`;
}
