import { vi } from 'vitest';
import type { ChainResult, RecordedWrite } from '../../common/testing/supabase-chain';
import { PenaltiesService } from '../penalties/penalties.service';
import { MatchForfeitsService } from './match-forfeits.service';
import {
  settleRules,
  type FighterStatusService,
  type SettleInput,
  type Settled,
} from './fighter-status.service';

/** `MatchForfeitsService` over `db` with no optional collaborator, and the status settle. */
export const forfeitsOver = (db: unknown, status: FighterStatusService = fighterStatusDouble()) =>
  new MatchForfeitsService(
    db as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    status,
  );

/** `PenaltiesService` over `db` with the collaborators named, and the status settle. */
export const penaltiesOver = (
  db: unknown,
  deps: { scoring?: unknown; frozen?: unknown; forfeits?: unknown; status?: unknown } = {},
) =>
  new PenaltiesService(
    db as never,
    deps.scoring as never,
    deps.frozen as never,
    undefined,
    deps.forfeits as never,
    undefined,
    (deps.status ?? fighterStatusDouble()) as FighterStatusService,
  );

/** One settle a door asked for: what it named, and the writes made before it. */
export interface SettledCall {
  input: SettleInput;
  writesBefore: RecordedWrite[];
}

/**
 * The status settle a test hands every service that settles (`MatchForfeitsService`,
 * `PenaltiesService`, `RegistrationsService`): it answers "nothing moved" and records each call,
 * in order, with the writes `writes()` held at that moment, so a test of a door can name what it
 * settled and after which of its own writes (`calls`). A test of WHAT the database is asked builds
 * the real `FighterStatusService` over an `.rpc` double instead (`settleRpc`); what the database
 * answers is probe check 16's (`scripts/lib/fighter-status-probe.mjs`).
 */
export function fighterStatusDouble(
  answer: Settled = { before: 'registered', after: 'registered' },
  writes: () => RecordedWrite[] = () => [],
) {
  const calls: SettledCall[] = [];
  const settle = vi.fn(async (input: SettleInput): Promise<Settled> => {
    calls.push({ input, writesBefore: [...writes()] });
    return answer;
  });
  return Object.assign({ settle } as unknown as FighterStatusService, { settle, calls });
}

/**
 * What a door asked the status settle last, as the database reads it: whether a 1st and a 2nd
 * live black card put the Fighter out. Undefined when it handed no rules (it read them itself).
 */
export const cardsPutOut = ({ status }: { status: ReturnType<typeof fighterStatusDouble> }) => {
  const rules = status.calls.at(-1)?.input.rules;
  return rules ? settleRules(rules) : undefined;
};

/** One call of `settle_fighter_status`: its arguments, and the writes made before it. */
export interface SettleCall {
  args: Record<string, unknown>;
  writesBefore: RecordedWrite[];
}

/**
 * The `.rpc` answer of `settle_fighter_status` for a `mockSupabase` double: it records each call
 * into `calls` with the writes `writes()` holds at that moment (the order a door claims: its cause
 * written, then settled), and answers `answer` (a refusal: `{ error }`).
 */
export function settleRpc(
  calls: SettleCall[],
  writes: () => RecordedWrite[],
  answer: ChainResult = { data: { before: 'checked_in', after: 'checked_in' }, error: null },
) {
  return {
    settle_fighter_status: (args: Record<string, unknown>): ChainResult => {
      calls.push({ args, writesBefore: [...writes()] });
      return answer;
    },
  };
}
