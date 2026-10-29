/**
 * The harness of the tests over a Tournament's forfeit rules through the settings save (the
 * audited settings change, commit 5b; `settings-forfeit.*.test.ts`): the seeded rules-write harness
 * with the card rules the Tournament plays under, the database's list of the Fighters a change
 * moves (`fighters_status_under`, answered by the test), the status settle's follow and the label
 * reader, each a recording double. What the database lists is probe check 19's; what the follow
 * does is `follow-rules-change.test.ts`'s.
 */
import { vi } from 'vitest';
import { CLUB_START_FORFEIT_RULES, type ForfeitChanges } from '@myclash/types/forfeit-rules';
import type { ChainResult } from '../../common/testing/supabase-chain';
import { labelKey } from '../entity-label/entity-label-specs';
import type { StatusRow } from '../matches/follow-rules-change';
import { harness, ON_TF_1_0_0, type Row } from './rules-write.fixtures';

export const FIGHTERS_READ = 'fighters_status_under';

/** The card rules the Tournament plays under: a club's start, "disqualify after" off (ruling 67). */
export const CARD_RULES: Row = {
  id: 'pr-built-in',
  built_in: true,
  owner_organization_id: null,
  accumulation_scope: 'tournament',
  yellow_card_points: 0,
  red_card_points: 1,
  black_card_points: 0,
  first_black_card_forfeit: 'match',
  second_black_card_forfeit: 'tournament',
  forfeit_rules: CLUB_START_FORFEIT_RULES,
  penalty_ruleset_entries: [],
};

/** A Tournament that runs (it locks by its status alone), holding `stored` as its own changes. */
export const runningWith = (stored: ForfeitChanges | null): Row => ({
  ...ON_TF_1_0_0,
  status: 'running',
  forfeit_rules: stored,
});

/** Fictional Fighters, by registration id. */
export const NAMES: Record<string, string> = {
  'reg-paul': 'Paul Martin',
  'reg-jean': 'Jean Dupont',
};

export const statusRow = (
  id: string,
  now: string,
  before: string,
  after: string,
  crossed: string | null = null,
): StatusRow => ({
  registration_id: id,
  status_now: now,
  status_before: before,
  status_after: after,
  crossed_at: crossed,
});

export interface ForfeitHarnessOptions {
  current: Row;
  /** What `fighters_status_under` answers. */
  rows?: StatusRow[];
  read?: ChainResult;
  cardRules?: Row[];
  /** What the label reader can name (`NAMES` unless given). */
  names?: Record<string, string>;
  /** What the follow answers. */
  followed?: {
    notSettled: string[];
    inStep: string[];
    handOffFailed: boolean;
    followFailed: boolean;
  };
  /** The settle is not wired. */
  noFighterStatus?: boolean;
  /** The Event's status (`published` unless given). */
  eventStatus?: string;
}

export function forfeitHarness(opts: ForfeitHarnessOptions) {
  const names = opts.names ?? NAMES;
  const labels = {
    resolve: vi.fn(async (refs: Map<string, Set<string>>) => {
      const found = new Map<string, string>();
      for (const id of refs.get('registration') ?? []) {
        if (names[id]) found.set(labelKey('registration', id), names[id]);
      }
      return { labels: found, users: new Map() };
    }),
  };
  const followRulesChange = vi.fn(
    async () =>
      opts.followed ?? { notSettled: [], inStep: [], handOffFailed: false, followFailed: false },
  );
  const reads: Record<string, unknown>[] = [];
  const opened = harness(
    opts.current,
    {},
    {
      penalty_rulesets: { rows: opts.cardRules ?? [CARD_RULES] },
      events: {
        rows: [{ id: 'e1', organization_id: 'org-1', status: opts.eventStatus ?? 'published' }],
      },
    },
    {
      functions: {
        [FIGHTERS_READ]: (args) => {
          reads.push(args);
          return opts.read ?? { data: opts.rows ?? [], error: null };
        },
      },
      fighterStatus: opts.noFighterStatus ? undefined : { followRulesChange },
      labels,
    },
  );
  return { ...opened, labels, followRulesChange, reads };
}

/** The settings save of `patch` by the organiser `u1`. */
export const save = (svc: ReturnType<typeof harness>['svc'], patch: Record<string, unknown>) =>
  svc.updateTournament('t1', patch as never, 'u1');
