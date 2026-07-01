import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '../ai-providers/adapters/provider-adapter.interface';
import { trimTranscript, MAX_CONTEXT_TOKENS } from './organizer-chat.transcript';

describe('trimTranscript', () => {
  it('returns the transcript unchanged when under the context budget', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(trimTranscript(msgs)).toBe(msgs);
  });

  it('drops old turns and keeps a window that starts at a user boundary', () => {
    const huge = 'x'.repeat((MAX_CONTEXT_TOKENS + 10_000) * 4); // ~70k tokens alone
    const msgs: ChatMessage[] = [
      { role: 'user', content: huge }, // over budget on its own → must be dropped
      { role: 'assistant', toolCalls: [{ id: 'tc_0', name: 'list_pools', arguments: {} }] },
      { role: 'tool', toolResults: [{ toolCallId: 'tc_0', content: '[]' }] },
      { role: 'user', content: 'recent question' },
      { role: 'assistant', content: 'recent answer' },
    ];

    const trimmed = trimTranscript(msgs);

    // Kept window must start on a user turn (valid transcript, no orphan tool_result).
    expect(trimmed[0]?.role).toBe('user');
    expect(trimmed[0]?.content).toBe('recent question');
    expect(trimmed).toHaveLength(2);
    // Never drops the newest turn.
    expect(trimmed[trimmed.length - 1]?.content).toBe('recent answer');
  });
});
