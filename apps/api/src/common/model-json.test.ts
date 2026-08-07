import { describe, expect, it } from 'vitest';
import { parseModelJson } from './model-json';

describe('parseModelJson', () => {
  it('parses a well-behaved raw JSON reply', () => {
    expect(parseModelJson<{ a: number }>('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('parses JSON wrapped in a ```json fence', () => {
    // The exact shape that broke every organizer setup-assistant draft in
    // production: the model obeyed "strict JSON only" and fenced it anyway.
    const reply = '```json\n{"summary":"ok","actions":[],"warnings":[]}\n```';
    expect(parseModelJson<{ summary: string }>(reply)).toEqual({
      ok: true,
      value: { summary: 'ok', actions: [], warnings: [] },
    });
  });

  it('parses JSON in a bare ``` fence with no language tag', () => {
    expect(parseModelJson('```\n[1,2,3]\n```')).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it('parses JSON surrounded by prose on both sides', () => {
    const reply = 'Here is the plan:\n\n{"actions":[{"kind":"create_tournament"}]}\n\nLet me know!';
    const result = parseModelJson<{ actions: unknown[] }>(reply);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.actions).toHaveLength(1);
  });

  it('does not mangle a string value that contains a closing brace', () => {
    // The widest-span strategy is only reached when earlier ones fail, but it
    // must not corrupt a payload it does handle.
    const reply = '```json\n{"summary":"use } carefully","actions":[]}\n```';
    const result = parseModelJson<{ summary: string }>(reply);
    expect(result.ok && result.value.summary).toBe('use } carefully');
  });

  it('reports the error against the original text, not an intermediate slice', () => {
    const result = parseModelJson('this is not JSON at all');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/JSON/i);
  });

  it('rejects an empty response with a message that says so', () => {
    expect(parseModelJson('   ')).toEqual({
      ok: false,
      error: 'Model returned an empty response',
    });
  });
});
