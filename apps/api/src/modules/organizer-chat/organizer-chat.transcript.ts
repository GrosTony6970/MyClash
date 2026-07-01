import type { ChatMessage } from '../ai-providers/adapters/provider-adapter.interface';

// Cap the input transcript so long conversations don't silently exceed the
// model context window (or run up per-turn cost). Well under the 200k model
// limit, leaving ample room for the system prompt + output.
export const MAX_CONTEXT_TOKENS = 60_000;

/** Cheap token estimate (~4 chars/token) covering content + tool call/result JSON. */
export function estTokens(m: ChatMessage): number {
  let chars = (m.content ?? '').length;
  if (m.toolCalls?.length) chars += JSON.stringify(m.toolCalls).length;
  if (m.toolResults?.length) chars += JSON.stringify(m.toolResults).length;
  return Math.ceil(chars / 4);
}

/**
 * Keep the most recent slice of the transcript within the context budget,
 * cutting only at a `user` boundary so the kept window is a valid Anthropic
 * transcript (starts with user, no orphaned tool_result). Falls back to the
 * last user turn if even that exceeds the budget (can't drop the live turn).
 */
export function trimTranscript(messages: ChatMessage[]): ChatMessage[] {
  const total = messages.reduce((s, m) => s + estTokens(m), 0);
  if (total <= MAX_CONTEXT_TOKENS) return messages;
  const userIdxs = messages.flatMap((m, i) => (m.role === 'user' ? [i] : []));
  if (userIdxs.length === 0) return messages;
  let start = userIdxs[userIdxs.length - 1] ?? 0;
  for (const idx of userIdxs) {
    const windowTokens = messages.slice(idx).reduce((s, m) => s + estTokens(m), 0);
    if (windowTokens <= MAX_CONTEXT_TOKENS) {
      start = idx;
      break;
    }
  }
  return messages.slice(start);
}
