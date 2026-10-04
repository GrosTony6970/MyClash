import { ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { STAFF_COOKIE_NAME, StaffService } from '../staff/staff.service';
import { MatchesController } from './matches.controller';

/**
 * Who reads a bout's record: its audit trail and its live forfeit (ruling 255).
 *
 * Both reads went through the organiser's WRITE bar, which refuses everybody
 * once the Event is over. So the bout page of a finished Event showed an error
 * where its audit trail should be, to the organiser too.
 *
 * - An editor of the club reads both, whatever the Event's status.
 * - On an over Event a super admin with no role in the club reads both: the
 *   corrections there are a super admin's (ruling 251). On a running Event a
 *   super admin is refused as before.
 *
 * The REAL controller and the REAL `StaffService` run here; the two read
 * services are spies.
 */
const ORG = 'org-1';
const EVENT = 'event-1';
const MATCH = 'm1';
const USER = 'a0000000-0000-4000-8000-000000000001';

type Caller = 'super admin' | 'editor' | 'scorekeeper' | 'stranger' | 'pad' | 'nobody';
const STATUSES = ['running', 'completed', 'archived'];
const OVER = ['completed', 'archived'];

/** One bout of one Event, as "who may score" reads it. */
const bout = (status: string) => ({
  id: MATCH,
  lice_id: 'lice-1',
  phases: {
    tournaments: {
      id: 'tournament-1',
      event_id: EVENT,
      lock_config_json: null,
      events: { organization_id: ORG, status },
    },
  },
});

function setup(status: string, caller: Caller) {
  const db = mockSupabase({
    matches: { rows: [bout(status)] },
    platform_roles: {
      rows: caller === 'super admin' ? [{ user_id: USER, role: 'super_admin' }] : [],
    },
  });
  // An editor holds the editor role and the roles under it; a scorekeeper that one alone.
  const held = (role: string) =>
    caller === 'editor' || (caller === 'scorekeeper' && role === 'scorekeeper');
  const assertOrgRole = vi.fn(async (_org: string, _user: string, role: string) => {
    if (!held(role)) throw new ForbiddenException('Not a member of this organization');
  });
  const staff = new StaffService(db as never, { assertOrgRole } as never, {} as never, {} as never);
  const account = caller !== 'pad' && caller !== 'nobody';
  vi.spyOn(
    staff as never as { getSupabaseUserId: () => Promise<string | null> },
    'getSupabaseUserId',
  ).mockResolvedValue(account ? USER : null);

  const audit = { listForMatch: vi.fn().mockResolvedValue(['an audit row']) };
  const forfeits = { getActiveForfeit: vi.fn().mockResolvedValue({ id: 'forfeit-1' }) };
  const controller = new MatchesController(
    {} as never,
    forfeits as never,
    {} as never,
    staff,
    audit as never,
    {} as never,
    db as never,
    { assertOrgRole } as never,
  );
  const req = (caller === 'pad'
    ? { cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }
    : { cookies: {}, headers: {} }) as unknown as FastifyRequest;
  return { assertOrgRole, audit, forfeits, controller, req };
}

type Setup = ReturnType<typeof setup>;
const READS: Array<[string, (s: Setup, bout?: string) => Promise<unknown>, unknown]> = [
  [
    'the audit trail',
    (s, bout = MATCH) => s.controller.listMatchAuditLog(bout, '50', s.req),
    ['an audit row'],
  ],
  [
    'the live forfeit',
    (s, bout = MATCH) => s.controller.getActiveForfeit(bout, s.req),
    { id: 'forfeit-1' },
  ],
];
const onEach = (statuses: string[]) =>
  statuses.flatMap((status) =>
    READS.map(([name, read, answer]) => [name, status, read, answer] as const),
  );

describe('the record of a bout (ruling 255)', () => {
  it.each(onEach(STATUSES))(
    'an editor of the club reads %s (%s)',
    async (_n, status, read, answer) => {
      const s = setup(status, 'editor');

      await expect(read(s)).resolves.toEqual(answer);
      expect(s.assertOrgRole).toHaveBeenCalledWith(ORG, USER, 'editor');
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
      expect(s.audit.listForMatch).not.toHaveBeenCalled();
      expect(s.forfeits.getActiveForfeit).not.toHaveBeenCalled();
    },
  );

  it.each(onEach(STATUSES))(
    'a scorekeeper and a stranger are refused %s (%s)',
    async (_n, status, read) => {
      for (const caller of ['scorekeeper', 'stranger'] as Caller[]) {
        const s = setup(status, caller);

        await expect(read(s)).rejects.toThrow('Not a member of this organization');
        expect(s.audit.listForMatch).not.toHaveBeenCalled();
        expect(s.forfeits.getActiveForfeit).not.toHaveBeenCalled();
      }
    },
  );

  it.each(onEach(STATUSES))(
    'a pad and a caller with no session are refused %s (%s)',
    async (_n, status, read) => {
      for (const caller of ['pad', 'nobody'] as Caller[]) {
        const s = setup(status, caller);

        await expect(read(s)).rejects.toThrow('Organizer session required');
        expect(s.audit.listForMatch).not.toHaveBeenCalled();
        expect(s.forfeits.getActiveForfeit).not.toHaveBeenCalled();
      }
    },
  );

  it.each(READS)('a bout that does not exist answers 404 for %s', async (_n, read) => {
    const s = setup('completed', 'editor');

    await expect(read(s, 'm-none')).rejects.toThrow('Match not found');
    expect(s.audit.listForMatch).not.toHaveBeenCalled();
    expect(s.forfeits.getActiveForfeit).not.toHaveBeenCalled();
  });
});
