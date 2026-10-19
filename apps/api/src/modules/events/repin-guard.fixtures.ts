/**
 * The settings save's harness for the ruleset re-pin guard and its restamp tests: the doubles
 * dispatch by TABLE NAME (the matches-mock lesson: an ordered queue desyncs the moment a query
 * is added). The importing test mocks `../phases/match-ruleset` (`restamped` reads that mock).
 */
import { vi } from 'vitest';
import { EventsService } from './events.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import { restampUnstartedMatches } from '../phases/match-ruleset';

/** The Tournaments whose bouts not yet started were stamped again, in order. */
export const restamped = () => vi.mocked(restampUnstartedMatches).mock.calls.map((call) => call[1]);

export const assertOrgRole = vi.fn();

const EVENT_ROW = { id: 'e1', organization_id: 'org-1' };

interface Captured {
  update: Record<string, unknown> | null;
  /** The lock's read of the bouts (`tournamentClockOf`): what it selected and filtered on. */
  boutsRead: { select: string; filters: unknown[][] } | null;
}

interface HarnessOpts {
  current: Record<string, unknown>;
  /** The Tournament's bouts, by status. */
  bouts?: Array<{ status: string }>;
  /** The bouts read fails. */
  boutsError?: { message: string };
}

function tournamentsChain(current: Record<string, unknown>, cap: Captured) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    update: vi.fn((p: Record<string, unknown>) => {
      cap.update = p;
      return chain;
    }),
    maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }),
    single: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ data: { ...current, ...(cap.update ?? {}) }, error: null }),
      ),
  });
  return chain;
}

function eventsChain() {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: EVENT_ROW, error: null }),
  });
  return chain;
}

/** The bouts, filtered by the status filters the read asks for, as PostgREST would. */
function matchesChain(opts: HarnessOpts, cap: Captured) {
  const read = { select: '', filters: [] as unknown[][] };
  let statuses: readonly string[] | null = null;
  let notStatus: string | null = null;
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn((columns: string) => {
      read.select = columns;
      cap.boutsRead = read;
      return chain;
    }),
    eq: vi.fn((...args: unknown[]) => {
      read.filters.push(['eq', ...args]);
      return chain;
    }),
    in: vi.fn((column: string, values: readonly string[]) => {
      read.filters.push(['in', column, values]);
      if (column === 'status') statuses = values;
      return chain;
    }),
    neq: vi.fn((column: string, value: string) => {
      read.filters.push(['neq', column, value]);
      if (column === 'status') notStatus = value;
      return chain;
    }),
    limit: vi.fn(() =>
      Promise.resolve(
        opts.boutsError
          ? { data: null, error: opts.boutsError }
          : {
              data: (opts.bouts ?? []).filter(
                (bout) => (statuses?.includes(bout.status) ?? true) && bout.status !== notStatus,
              ),
              error: null,
            },
      ),
    ),
  });
  return chain;
}

/** custom_rulesets read during the reseed (no override row) + safe fallback. */
function nullRowChain() {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  return chain;
}

export function harness(opts: HarnessOpts) {
  const cap: Captured = { update: null, boutsRead: null };
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'tournaments') return tournamentsChain(opts.current, cap);
    if (table === 'events') return eventsChain();
    if (table === 'matches') return matchesChain(opts, cap);
    return nullRowChain();
  });
  // A club ruleset this file names is offered to nobody; a built-in needs no read.
  const selectableRulesets = {
    offeredVersion: vi.fn().mockResolvedValue(null),
    draftsOfferedTo: vi.fn().mockResolvedValue(false),
  };
  const svc = new EventsService(
    { service: { from } } as never,
    { assertOrgRole } as never,
    {} as never,
    createRulesetRegistry(),
    undefined,
    undefined,
    undefined,
    undefined,
    selectableRulesets as never,
  );
  return { svc, cap, selectableRulesets };
}

export const RUNNING_TF = {
  id: 't1',
  event_id: 'e1',
  status: 'running',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: { winBonus: 3 },
};
