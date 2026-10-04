import { ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { PenaltiesController } from '../penalties/penalties.controller';
import { STAFF_COOKIE_NAME, StaffService } from '../staff/staff.service';
import { MatchesController } from './matches.controller';

/**
 * Three reads of a bout answer on an over Event (ruling 259): what undoing its
 * result would cost, its card rules and its card history.
 *
 * Each went through "who may score" as a WRITE does, which refuses everybody
 * once the Event is over. So the organiser of a finished Event opened the undo
 * dialog with no answer behind it: it offered an undo the server then refused.
 * A pad that drains a queued card there could not price it.
 *
 * - Who may score the bout on a running Event reads them on an over Event too:
 *   a scorekeeper of the club, a pad assigned to the bout's piste.
 * - On an over Event a super admin reads them with no role in the club (ruling
 *   251). On a running Event a super admin is refused as before.
 *
 * The REAL controllers and the REAL `StaffService` run here; the read services
 * are spies.
 */
const ORG = 'org-1';
const EVENT = 'event-1';
const MATCH = 'm1';
const LICE = 'lice-1';
const USER = 'a0000000-0000-4000-8000-000000000001';

type Caller =
  | 'super admin'
  | 'editor'
  | 'scorekeeper'
  | 'stranger'
  | 'pad'
  | 'pad of another piste'
  | 'disabled pad'
  | 'nobody';
const STATUSES = ['running', 'completed', 'archived'];
const OVER = ['completed', 'archived'];
const PADS: Caller[] = ['pad', 'pad of another piste', 'disabled pad'];

/** One bout of one Event, and the one pad account of its piste. */
function database(status: string, caller: Caller) {
  return mockSupabase({
    matches: {
      rows: [
        {
          id: MATCH,
          lice_id: LICE,
          phases: {
            tournaments: {
              id: 'tournament-1',
              event_id: EVENT,
              lock_config_json: null,
              events: { organization_id: ORG, status },
            },
          },
        },
      ],
    },
    events: { rows: [{ id: EVENT, organization_id: ORG, status, end_date: '2026-10-03' }] },
    platform_roles: {
      rows: caller === 'super admin' ? [{ user_id: USER, role: 'super_admin' }] : [],
    },
    event_staff_accounts: {
      rows: [
        {
          id: 'staff-1',
          event_id: EVENT,
          status: caller === 'disabled pad' ? 'disabled' : 'active',
          role: 'scoring',
        },
      ],
    },
    event_staff_lice_assignments: {
      rows: [
        {
          id: 'assignment-1',
          staff_account_id: 'staff-1',
          lice_id: caller === 'pad of another piste' ? 'lice-2' : LICE,
        },
      ],
    },
  });
}

function setup(status: string, caller: Caller) {
  const db = database(status, caller);
  // An editor holds the editor role and the roles under it; a scorekeeper that one alone.
  const held = (role: string) =>
    caller === 'editor' || (caller === 'scorekeeper' && role === 'scorekeeper');
  const assertOrgRole = vi.fn(async (_org: string, _user: string, role: string) => {
    if (!held(role)) throw new ForbiddenException('Not a member of this organization');
  });
  const verify = () => ({ sub: 'staff-1', event_id: EVENT, type: 'staff' });
  const staff = new StaffService(
    db as never,
    { assertOrgRole } as never,
    { verify } as never,
    {} as never,
  );
  const account = !PADS.includes(caller) && caller !== 'nobody';
  vi.spyOn(
    staff as never as { getSupabaseUserId: () => Promise<string | null> },
    'getSupabaseUserId',
  ).mockResolvedValue(account ? USER : null);

  const completion = { previewUncompletion: vi.fn().mockResolvedValue({ frozen: true }) };
  const penalties = {
    getEffectiveRulesetForMatch: vi.fn().mockResolvedValue({ id: 'ruleset-1' }),
    getPenaltyScopeForMatch: vi.fn().mockResolvedValue({ priorByRegistration: {} }),
  };
  const matchesController = new MatchesController(
    {} as never,
    {} as never,
    {} as never,
    staff,
    {} as never,
    completion as never,
    db as never,
    { assertOrgRole } as never,
  );
  const penaltiesController = new PenaltiesController(penalties as never, db as never, staff, {
    assertOrgRole,
  } as never);
  const req = (PADS.includes(caller)
    ? { cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }
    : { cookies: {}, headers: {} }) as unknown as FastifyRequest;
  const answered = () =>
    completion.previewUncompletion.mock.calls.length +
    penalties.getEffectiveRulesetForMatch.mock.calls.length +
    penalties.getPenaltyScopeForMatch.mock.calls.length;
  return { completion, penalties, matchesController, penaltiesController, req, answered };
}

type Setup = ReturnType<typeof setup>;
const READS: Array<[string, (s: Setup, bout?: string) => Promise<unknown>, unknown]> = [
  [
    'the undo preview',
    (s, bout = MATCH) => s.matchesController.uncompletePreflight(bout, s.req),
    { frozen: true },
  ],
  [
    'the card rules',
    (s, bout = MATCH) => s.penaltiesController.getMatchPenaltyRuleset(bout, s.req),
    { id: 'ruleset-1' },
  ],
  [
    'the card history',
    (s, bout = MATCH) => s.penaltiesController.getMatchPenaltyScope(bout, s.req),
    { priorByRegistration: {} },
  ],
];
const onEach = (statuses: string[]) =>
  statuses.flatMap((status) =>
    READS.map(([name, read, answer]) => [name, status, read, answer] as const),
  );

describe('three reads of a bout answer on an over Event (ruling 259)', () => {
  it.each(onEach(STATUSES))(
    'a scorekeeper and an editor of the club read %s (%s)',
    async (_n, status, read, answer) => {
      for (const caller of ['scorekeeper', 'editor'] as Caller[]) {
        await expect(read(setup(status, caller))).resolves.toEqual(answer);
      }
    },
  );

  it.each(onEach(STATUSES))(
    'a pad assigned to the bout’s piste reads %s (%s)',
    async (_n, status, read, answer) => {
      await expect(read(setup(status, 'pad'))).resolves.toEqual(answer);
    },
  );

  it.each(onEach(OVER))(
    'a super admin with no role reads %s (%s)',
    async (_n, status, read, answer) => {
      await expect(read(setup(status, 'super admin'))).resolves.toEqual(answer);
    },
  );

  it.each(READS)(
    'on a running Event a super admin with no role is refused %s',
    async (_n, read) => {
      const s = setup('running', 'super admin');

      await expect(read(s)).rejects.toThrow('Not a member of this organization');
      expect(s.answered()).toBe(0);
    },
  );

  it.each(onEach(STATUSES))('a stranger is refused %s (%s)', async (_n, status, read) => {
    const s = setup(status, 'stranger');

    await expect(read(s)).rejects.toThrow('Not a member of this organization');
    expect(s.answered()).toBe(0);
  });

  it.each(onEach(STATUSES))(
    'a pad of another piste and a disabled pad are refused %s (%s)',
    async (_n, status, read) => {
      const other = setup(status, 'pad of another piste');
      await expect(read(other)).rejects.toThrow(/not assigned to this Lice/i);
      expect(other.answered()).toBe(0);

      const disabled = setup(status, 'disabled pad');
      await expect(read(disabled)).rejects.toBeInstanceOf(ForbiddenException);
      expect(disabled.answered()).toBe(0);
    },
  );

  it.each(onEach(STATUSES))(
    'a caller with no session is refused %s (%s)',
    async (_n, status, read) => {
      const s = setup(status, 'nobody');

      await expect(read(s)).rejects.toThrow('Staff session required');
      expect(s.answered()).toBe(0);
    },
  );

  it.each(READS)('a bout that does not exist answers 404 for %s', async (_n, read) => {
    const s = setup('completed', 'editor');

    await expect(read(s, 'm-none')).rejects.toThrow('Match not found');
    expect(s.answered()).toBe(0);
  });
});

describe('the undo preview says who could discard later bouts', () => {
  const discard = async (status: string, caller: Caller) => {
    const s = setup(status, caller);
    await s.matchesController.uncompletePreflight(MATCH, s.req);
    return s.completion.previewUncompletion.mock.calls[0]?.[1];
  };

  it('on a running Event an editor can, a scorekeeper cannot', async () => {
    expect(await discard('running', 'editor')).toMatchObject({ canDiscardDependentResults: true });
    expect(await discard('running', 'scorekeeper')).toMatchObject({
      canDiscardDependentResults: false,
    });
  });

  // Every undo is refused on an over Event, to a super admin too.
  it.each(OVER)('on a %s Event nobody can', async (status) => {
    for (const caller of ['editor', 'super admin', 'pad'] as Caller[]) {
      expect(await discard(status, caller)).toMatchObject({ canDiscardDependentResults: false });
    }
  });
});
