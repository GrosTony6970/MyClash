import { describe, it, expect } from 'vitest';
import {
  ORGANIZER_CHAT_TOOLS,
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  isReadTool,
  isWriteTool,
} from './organizer-chat.tools';

describe('organizer-chat tools registry', () => {
  it('classifies every registered tool as exactly read or write', () => {
    for (const tool of ORGANIZER_CHAT_TOOLS) {
      expect(isReadTool(tool.name) || isWriteTool(tool.name)).toBe(true);
      expect(isReadTool(tool.name) && isWriteTool(tool.name)).toBe(false);
    }
  });

  it('write tool names are identical to the applyAction kinds', () => {
    expect([...WRITE_TOOL_NAMES].sort()).toEqual(
      [
        'assign_referee',
        'create_tournament',
        'generate_bracket',
        'generate_pools',
        'schedule_match',
      ].sort(),
    );
  });

  it('read and write sets are disjoint', () => {
    for (const name of READ_TOOL_NAMES) expect(isWriteTool(name)).toBe(false);
    for (const name of WRITE_TOOL_NAMES) expect(isReadTool(name)).toBe(false);
  });

  it('every tool exposes a JSON-schema object for parameters', () => {
    for (const tool of ORGANIZER_CHAT_TOOLS) {
      expect((tool.parameters as { type?: string }).type).toBe('object');
    }
  });
});
