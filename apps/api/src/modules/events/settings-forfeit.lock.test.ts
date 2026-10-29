/**
 * A Tournament's forfeit rules under the lock of its settings save (the audited settings change,
 * commit 5b; operator rulings 142, 143, 147, 148). Once it has started, a change of its forfeit
 * rules is not saved: the save is refused `rules_change_needs_audit`, listing each rule that moves
 * as the rules IN FORCE (the penalty ruleset's, the Tournament's changes over them) and naming the
 * Fighters whose status the change moves, from the database's own rule. The audited resend is
 * `settings-forfeit.audited.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RULES_CHANGE_CODES } from '@myclash/types';
import { CLUB_START_FORFEIT_RULES } from '@myclash/types/forfeit-rules';
import type * as MatchRuleset from '../phases/match-ruleset';
import { writesTo } from '../../common/testing/supabase-chain';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { settleRules } from '../matches/fighter-status.service';
import { assertOrgRole, ON_TF_1_0_0, refusal, RPC, type Row } from './rules-write.fixtures';
import {
  CARD_RULES,
  FIGHTERS_READ,
  forfeitHarness,
  runningWith,
  save,
  statusRow,
} from './settings-forfeit.fixtures';

vi.mock('../phases/match-ruleset', async (original) => ({
  ...(await original<typeof MatchRuleset>()),
  restampUnstartedMatches: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  vi.clearAllMocks();
  assertOrgRole.mockResolvedValue(undefined);
});

const OFF = settleRules({
  ...CLUB_START_FORFEIT_RULES,
  firstBlackCard: 'match',
  secondBlackCard: 'tournament',
});
const AFTER_2 = { ...OFF, disqualifyAfter: 2 };
const PAUL_OUT = statusRow(
  'reg-paul',
  'registered',
  'registered',
  'disqualified',
  '2026-10-21T10:00:00Z',
);
// Out of step with the rules before and after alike: the change does not move them.
const ANN_STALE = statusRow(
  'reg-ann',
  'registered',
  'disqualified',
  'disqualified',
  '2026-10-21T09:00:00Z',
);

/** Nothing reached the Tournament: no row write, no audited write. */
const nothingWritten = (h: ReturnType<typeof forfeitHarness>) => {
  expect(writesTo(h.db, 'tournaments')).toEqual([]);
  expect(h.db.rpc.mock.calls.map(([name]) => name)).not.toContain(RPC);
};

describe('a forfeit rules change once the Tournament has started', () => {
  it('is refused with each rule in force that moves, and the Fighters it moves, named', async () => {
    const h = forfeitHarness({ current: runningWith(null), rows: [ANN_STALE, PAUL_OUT] });
    const { status, body } = await refusal(save(h.svc, { forfeitRules: { disqualifyAfter: 2 } }));

    expect([status, body['code']]).toEqual([403, RULES_CHANGE_CODES.needsAudit]);
    expect(body['changes']).toEqual([
      { path: 'forfeitRules.disqualifyAfter', before: 'off', after: 2, locked: true },
    ]);
    expect(body['fighters']).toEqual([
      {
        registrationId: 'reg-paul',
        name: 'Paul Martin',
        before: 'registered',
        after: 'disqualified',
      },
    ]);
    nothingWritten(h);
  });

  it('asks the database for the Fighters under the rules before and after, naming none', async () => {
    const h = forfeitHarness({ current: runningWith(null), rows: [PAUL_OUT] });
    await refusal(save(h.svc, { forfeitRules: { disqualifyAfter: 2 } }));

    expect(h.reads).toEqual([
      { p_tournament: 't1', p_rules_before: OFF, p_rules_after: AFTER_2, p_also: [] },
    ]);
    expect(Object.keys(h.reads[0]!)).toEqual(lastFunctionParams(FIGHTERS_READ));
  });

  it('lists a per-reason score change and reads no Fighter: it moves no status', async () => {
    const h = forfeitHarness({ current: runningWith(null), rows: [PAUL_OUT] });
    const patch = { forfeitRules: { reasons: { injury: { opponentScore: 9 } } } };
    const { body } = await refusal(save(h.svc, patch));

    expect(body['changes']).toEqual([
      { path: 'forfeitRules.reasons.injury.opponentScore', before: 6, after: 9, locked: true },
    ]);
    expect(body['fighters']).toEqual([]);
    expect(h.reads).toEqual([]);
    expect(h.labels.resolve).not.toHaveBeenCalled();
  });

  it('lists a stored change equal to the ruleset’s value as set (ruling 147)', async () => {
    const h = forfeitHarness({ current: runningWith(null) });
    const patch = { forfeitRules: { reasons: { voluntary: { fighter: 'asks' } } } };
    const { status, body } = await refusal(save(h.svc, patch));

    expect(status).toBe(403);
    expect(body['changes']).toEqual([
      {
        path: 'forfeitRules.reasons.voluntary.fighter',
        before: 'asks',
        after: 'asks',
        stored: 'set',
        locked: true,
      },
    ]);
  });

  it('names 151 Fighters through reads of 150 names at most', async () => {
    const ids = Array.from({ length: 151 }, (_, i) => `reg-${String(i).padStart(3, '0')}`);
    const names = Object.fromEntries(ids.map((id) => [id, `Fighter ${id}`]));
    const rows = ids.map((id) => statusRow(id, 'registered', 'registered', 'disqualified'));
    const h = forfeitHarness({ current: runningWith(null), rows, names });
    const { body } = await refusal(save(h.svc, { forfeitRules: { disqualifyAfter: 2 } }));

    expect(body['fighters']).toHaveLength(151);
    expect((body['fighters'] as Row[]).map((f) => f['name'])).toEqual(ids.map((id) => names[id]));
    const asked = h.labels.resolve.mock.calls.map(([refs]) => refs.get('registration')?.size);
    expect(asked).toEqual([150, 1]);
  });
});

describe('the rules before a save that do not parse (a repair)', () => {
  // "Disqualify after 99" is out of range: the stored change cannot be read.
  const BROKEN = { disqualifyAfter: 99 } as never;

  it('list one other forfeit rule, path only, and name the Fighters out of step', async () => {
    const back = statusRow('reg-jean', 'disqualified', 'registered', 'registered');
    const h = forfeitHarness({ current: runningWith(BROKEN), rows: [PAUL_OUT, back] });
    const { body } = await refusal(save(h.svc, { forfeitRules: { disqualifyAfter: null } }));

    expect(body['changes']).toEqual([
      { path: 'forfeitRules.unknown', before: null, after: null, locked: true },
    ]);
    expect(body['fighters']).toEqual([
      {
        registrationId: 'reg-paul',
        name: 'Paul Martin',
        before: 'registered',
        after: 'disqualified',
      },
      {
        registrationId: 'reg-jean',
        name: 'Jean Dupont',
        before: 'disqualified',
        after: 'registered',
      },
    ]);
    // The rules after on both sides: whoever is out of step with them is the change.
    expect(h.reads[0]).toMatchObject({ p_rules_before: OFF, p_rules_after: OFF });
  });

  it('refuse 409 a save that keeps the broken change, naming it as the cause', async () => {
    const h = forfeitHarness({ current: runningWith(BROKEN) });
    const { status, body } = await refusal(
      save(h.svc, { forfeitRules: { blackCardOpponentScore: 7 } }),
    );
    expect([status, body['code'], body['cause']]).toEqual([
      409,
      'forfeit_rules_invalid',
      'changes',
    ]);
    expect(h.reads).toEqual([]);
    nothingWritten(h);
  });
});

describe('a forfeit rules change the lock cannot check', () => {
  it('is refused 409 when the penalty ruleset’s own rules do not parse', async () => {
    const broken = { ...CARD_RULES, forfeit_rules: { disqualifyAfter: 'never' } };
    const h = forfeitHarness({ current: runningWith(null), cardRules: [broken] });
    const { status, body } = await refusal(save(h.svc, { forfeitRules: { disqualifyAfter: 2 } }));
    expect([status, body['code'], body['cause']]).toEqual([
      409,
      'forfeit_rules_invalid',
      'ruleset',
    ]);
    nothingWritten(h);
  });

  it.each([
    ['the card rules cannot be read', { cardRules: [] }],
    ['the Fighters cannot be read', { read: { data: null, error: { message: 'timeout' } } }],
    ['a Fighter it moves cannot be named', { names: {} }],
  ])('is refused 503 when %s', async (_, over) => {
    const h = forfeitHarness({ current: runningWith(null), rows: [PAUL_OUT], ...over });
    const { status, body } = await refusal(save(h.svc, { forfeitRules: { disqualifyAfter: 2 } }));
    expect([status, body['code']]).toEqual([503, RULES_CHANGE_CODES.checkUnavailable]);
    nothingWritten(h);
  });
});

describe('a forfeit rules change the lock does not refuse, or refuses first otherwise', () => {
  it('is saved on a Tournament not started, reading neither the card rules nor the Fighters', async () => {
    // No card rules at all: a read of them would refuse 503.
    const h = forfeitHarness({ current: { ...ON_TF_1_0_0, forfeit_rules: null }, cardRules: [] });
    await save(h.svc, { forfeitRules: { disqualifyAfter: 2 } });

    const [write] = writesTo(h.db, 'tournaments');
    expect((write!.row as Row)['forfeit_rules']).toEqual({ disqualifyAfter: 2 });
    expect(h.reads).toEqual([]);
  });

  it('is refused as a card change with the pin, before any Fighter is read', async () => {
    const h = forfeitHarness({ current: runningWith(null), rows: [PAUL_OUT] });
    const { body } = await refusal(
      save(h.svc, { penaltyRulesetId: 'pr-2', forfeitRules: { disqualifyAfter: 2 } }),
    );
    expect(body['code']).toBe(RULES_CHANGE_CODES.cardLocked);
    expect(h.reads).toEqual([]);
  });

  it('is refused as closed under an Event that is over, naming no one (ruling 148)', async () => {
    const h = forfeitHarness({
      current: runningWith(null),
      rows: [PAUL_OUT],
      eventStatus: 'completed',
    });
    const { status, body } = await refusal(save(h.svc, { forfeitRules: { disqualifyAfter: 2 } }));
    expect([status, body['code'], body['closedBy']]).toEqual([
      403,
      RULES_CHANGE_CODES.closed,
      'event',
    ]);
    expect(h.reads).toEqual([]);
    expect(h.labels.resolve).not.toHaveBeenCalled();
  });
});
