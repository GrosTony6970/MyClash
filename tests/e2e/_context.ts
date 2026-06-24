import { readFileSync } from 'node:fs';

export type RunContext = {
  orgId: string;
  orgSlug: string;
  eventId: string;
  eventSlug: string;
  baseURL: string;
};

/**
 * Reads the run context written by global-setup (org + throwaway event ids).
 * Specs use this instead of hard-coding any prod ids.
 */
export function runContext(): RunContext {
  return JSON.parse(readFileSync('tests/e2e/.auth/context.json', 'utf8')) as RunContext;
}
