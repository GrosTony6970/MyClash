import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { StaffService, STAFF_COOKIE_NAME } from './staff.service';
import { liceBouts } from './lice-bouts';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { summarySeed } from '../matches/match-summaries.fixtures';
import { builtInResolver } from '../matches/built-in-resolver.fixtures';

/**
 * `GET /staff/lices/:liceId/bouts`: every bout of a piste, each as the pad reads
 * one bout, for the tablet to keep (quick-win ruling 4).
 *
 * The bar is the piste list's: a scoring session that is active and assigned to
 * THIS piste. The assignment is also what keeps another Event's tablet out: a
 * staff account is assigned only pistes of its own Event.
 */

const EVENT = 'event-1';
const ACCOUNT = 'staff-1';
const LICE = 'lice-1';

const at = (minute: number) => `2026-08-08T10:${String(minute).padStart(2, '0')}:00.000Z`;

/** A whole `matches` row. The four ids are the bouts `summarySeed` describes. */
const bout = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  lice_id: LICE,
  status: 'scheduled',
  scheduled_at: at(0),
  match_number_label: 'L1-P1-M3',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  red_registration_id: `red-${id}`,
  blue_registration_id: `blue-${id}`,
  red_score: 0,
  blue_score: 0,
  // Its copy of its rules (0229): no format set.
  match_rules: { ruleset_config: {} },
  ...over,
});

const BOUTS = [
  bout('swiss', { scheduled_at: at(30), ruleset_version: '1.1.0' }),
  bout('bracket', { scheduled_at: at(20), status: 'completed', red_score: 5, blue_score: 3 }),
  // Same hour as `pool`, and a higher number: text order would put it first.
  bout('late', { match_number_label: 'L1-P1-M10' }),
  bout('pool', { match_number_label: 'L1-P1-M3' }),
  bout('voided', { status: 'voided' }),
  bout('elsewhere', { lice_id: 'lice-9' }),
];

const staffRequest = () =>
  ({ cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }) as unknown as FastifyRequest;

interface BuildOpts {
  role?: string;
  status?: string;
  assigned?: boolean;
  eventStatus?: string;
  withResolver?: boolean;
}

function build(opts: BuildOpts = {}) {
  const supabase = mockSupabase({
    ...summarySeed(),
    matches: { rows: BOUTS },
    event_staff_accounts: {
      rows: [
        {
          id: ACCOUNT,
          event_id: EVENT,
          display_name: 'Marie Dubois',
          username: 'marie',
          pin_hash: 'x',
          status: opts.status ?? 'active',
          role: opts.role ?? 'scoring',
        },
      ],
    },
    events: {
      rows: [
        {
          id: EVENT,
          organization_id: 'org-1',
          slug: 'fal-2026',
          name: 'FAL 2026',
          status: opts.eventStatus ?? 'running',
          start_date: '2026-08-08',
          end_date: '2099-12-31',
          timezone: 'Europe/Lisbon',
        },
      ],
    },
    event_staff_lice_assignments: {
      rows:
        opts.assigned === false
          ? []
          : [{ id: 'assignment-1', staff_account_id: ACCOUNT, lice_id: LICE }],
    },
  });
  const jwt = { verify: () => ({ sub: ACCOUNT, event_id: EVENT, type: 'staff' }) };
  const rulesets = opts.withResolver ? builtInResolver() : undefined;
  const svc = new StaffService(supabase as never, {} as never, jwt as never, {} as never, rulesets);
  return { svc, from: supabase.from };
}

describe('StaffService.getAssignedLiceBouts', () => {
  it('gives each bout the end-decision edition of its own ruleset version', async () => {
    const { svc } = build({ withResolver: true });

    const { bouts } = await svc.getAssignedLiceBouts(staffRequest(), LICE);

    const editions = bouts.map((entry) => [entry.match['id'], entry.match['decision_edition']]);
    expect(editions).toEqual([
      ['pool', '2026-04'],
      ['late', '2026-04'],
      ['bracket', '2026-04'],
      ['swiss', '2026-10'],
    ]);
  });

  it('gives a bout no edition when no resolver is there to read it', async () => {
    const { svc } = build();
    const { bouts } = await svc.getAssignedLiceBouts(staffRequest(), LICE);
    expect(bouts.every((entry) => !('decision_edition' in entry.match))).toBe(true);
  });

  it('answers every bout of the piste in the order of the piste list', async () => {
    const { svc } = build();

    const payload = await svc.getAssignedLiceBouts(staffRequest(), LICE);

    expect(payload.liceId).toBe(LICE);
    // Raw: the caller prefixes nothing, as on the piste list.
    expect(payload.liceName).toBe('Lice 4');
    // A voided bout and a bout of the next piste are not this piste's.
    expect(payload.bouts.map((entry) => entry.match['id'])).toEqual([
      'pool',
      'late',
      'bracket',
      'swiss',
    ]);
  });

  it('gives each bout its whole row and the summary of the single-bout route', async () => {
    const { svc } = build();

    const { bouts } = await svc.getAssignedLiceBouts(staffRequest(), LICE);
    const played = bouts.find((entry) => entry.match['id'] === 'bracket')!;

    expect(played.match).toEqual(BOUTS[1]);
    expect(played.summary).toMatchObject({
      roundCode: 'SBR-B-WBSF-M2',
      redName: 'Red bracket',
      tournamentId: 't2',
      bestOf: 1,
    });
  });

  // A bout deleted between the read of the rows and the read of the view: the
  // single-bout summary is a 404 there. Here it is a null, not a gap in the list.
  it('gives a bout the summary view does not hold a null summary', async () => {
    const { svc } = build();

    const { bouts } = await svc.getAssignedLiceBouts(staffRequest(), LICE);

    expect(bouts.find((entry) => entry.match['id'] === 'late')).toEqual({
      match: BOUTS[2],
      summary: null,
    });
  });

  // The double answers the whole row whatever is selected.
  it('selects the whole row of a bout, as GET /matches/:id does', async () => {
    const { svc, from } = build();
    await svc.getAssignedLiceBouts(staffRequest(), LICE);

    expect(selectsFor(from, 'matches')[0]).toBe('*');
    expect(selectsFor(from, 'lices')[0]).toBe('id,name');
  });

  describe('who may read it', () => {
    const refused = async (svc: StaffService, req: FastifyRequest) =>
      svc.getAssignedLiceBouts(req, LICE).catch((error: unknown) => error);

    it('refuses a caller with no staff session, before any bout is read', async () => {
      const { svc, from } = build();
      const anonymous = { cookies: {}, headers: {} } as unknown as FastifyRequest;

      expect(await refused(svc, anonymous)).toBeInstanceOf(UnauthorizedException);
      expect(queriedTables(from)).toEqual([]);
    });

    it('refuses a staff session that is not assigned to this piste', async () => {
      const { svc, from } = build({ assigned: false });

      expect(await refused(svc, staffRequest())).toEqual(
        new ForbiddenException('Staff account is not assigned to this Lice'),
      );
      expect(queriedTables(from)).not.toContain('matches');
    });

    it('refuses a disabled account and a check-in desk account, though assigned', async () => {
      for (const opts of [{ status: 'disabled' }, { role: 'checkin' }]) {
        const { svc, from } = build(opts);

        expect(await refused(svc, staffRequest())).toBeInstanceOf(ForbiddenException);
        expect(queriedTables(from)).not.toContain('matches');
      }
    });

    // As the piste list: a PIN of a finished Event opens nothing. The tablet
    // keeps what it holds on this answer (the pad's side of the read).
    it('refuses a session of an Event that is completed or archived', async () => {
      for (const eventStatus of ['completed', 'archived']) {
        const { svc, from } = build({ eventStatus });

        expect(await refused(svc, staffRequest())).toBeInstanceOf(ForbiddenException);
        expect(queriedTables(from)).not.toContain('matches');
      }
    });
  });
});

describe('liceBouts', () => {
  it('answers a piste that is gone as the piste list does', async () => {
    const supabase = mockSupabase({ lices: { rows: [] } });

    await expect(
      liceBouts(supabase.service as never, 'nowhere', undefined, console),
    ).rejects.toEqual(new NotFoundException('Lice not found'));
  });

  it('answers an empty piste with no bout, and reads no summary', async () => {
    const supabase = mockSupabase({
      lices: { rows: [{ id: LICE, name: 'Lice 4' }] },
      matches: { rows: [] },
    });

    expect(await liceBouts(supabase.service as never, LICE, undefined, console)).toEqual({
      liceId: LICE,
      liceName: 'Lice 4',
      bouts: [],
    });
  });
});
