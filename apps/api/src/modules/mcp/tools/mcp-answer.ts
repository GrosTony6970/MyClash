import { Logger } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const logger = new Logger('McpServer');

/**
 * The answer of a tool that failed. The SDK would send the error's own message, which can be a
 * database's; this one says nothing about the cause, and the cause goes to the log.
 */
function failed(tool: string, error: unknown): CallToolResult {
  logger.error(
    `mcp tool ${tool} failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  return {
    isError: true,
    content: [{ type: 'text', text: 'MyClash could not answer this. Try again later.' }],
  };
}

/** The answer of a tool that refuses with one plain sentence: a tool error result, never a throw. */
function toolRefusal(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/**
 * What a tool returns to refuse: one plain sentence. A result is a refusal when it is an object
 * whose only key is a string `refusal`; every real answer has other keys, so none is mistaken
 * for one.
 */
export interface McpRefusal {
  refusal: string;
}

export function isRefusal(result: unknown): result is McpRefusal {
  if (typeof result !== 'object' || result === null) return false;
  const keys = Object.keys(result);
  return (
    keys.length === 1 && keys[0] === 'refusal' && typeof (result as McpRefusal).refusal === 'string'
  );
}

/** The one owner of a tool's answer: JSON text, a refusal as an error result, a throw scrubbed. */
export async function answer(tool: string, run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await run();
    if (isRefusal(result)) return toolRefusal(result.refusal);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    return failed(tool, error);
  }
}

/** An Event or Tournament named by its slug, the handle `my_events` gives. */
export const slug = z.string().min(1).max(200);
