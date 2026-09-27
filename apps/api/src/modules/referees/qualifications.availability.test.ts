/**
 * The availability write, at the door (ADR-019, rulings 145-147, 149): the body the controller
 * accepts, who may write, and what reaches the roster. The rules on the rows themselves are in
 * referee-availability.test.ts.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { UpdateRefereeAvailabilityDto } from './qualifications.controller';
import { QualificationsService } from './qualifications.service';

const parse = (body: unknown) => UpdateRefereeAvailabilityDto.schema.safeParse(body);
const messages = (body: unknown) => {
  const result = parse(body);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('the availability body', () => {
  it('takes Tournaments and days, each day with both minutes or neither', () => {
    expect(
      parse({
        tournamentIds: ['00000000-0000-4000-8000-000000000001'],
        days: [{ date: '2026-09-12' }, { date: '2026-09-13', fromMinute: 540, toMinute: 1440 }],
      }).success,
    ).toBe(true);
    expect(parse({}).success).toBe(true);
  });

  it.each(['availableAllTournaments', 'availableAllEventDuration', 'dayIndices'])(
    'refuses the gone key %s by name (ruling 145)',
    (key) => {
      const result = parse({ [key]: key === 'dayIndices' ? [0] : true });
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error!.issues)).toContain(key);
    },
  );

  it('refuses one minute without the other, and a window that does not run forward', () => {
    expect(messages({ days: [{ date: '2026-09-12', fromMinute: 540 }] })).toEqual([
      'Give both fromMinute and toMinute, or neither.',
    ]);
    expect(messages({ days: [{ date: '2026-09-12', fromMinute: 600, toMinute: 600 }] })).toEqual([
      'fromMinute must be before toMinute.',
    ]);
  });

  it('refuses minutes outside a day, a date that is not one, and the same date or Tournament twice', () => {
    expect(parse({ days: [{ date: '2026-09-12', fromMinute: -1, toMinute: 60 }] }).success).toBe(
      false,
    );
    expect(parse({ days: [{ date: '2026-09-12', fromMinute: 0, toMinute: 1441 }] }).success).toBe(
      false,
    );
    expect(parse({ days: [{ date: '12/09/2026' }] }).success).toBe(false);
    expect(messages({ days: [{ date: '2026-09-12' }, { date: '2026-09-12' }] })).toEqual([
      'Each date may appear once.',
    ]);
    // Twice would pass the checks, then fail the insert after the delete: no Tournament left.
    const id = '00000000-0000-4000-8000-000000000001';
    expect(messages({ tournamentIds: [id, id] })).toEqual(['Each Tournament may appear once.']);
  });
});

describe('QualificationsService.updateAvailability', () => {
  const organizations = { assertOrgRole: vi.fn() };
  beforeEach(() => {
    organizations.assertOrgRole.mockReset().mockResolvedValue(undefined);
  });

  const tables = (roster: Array<{ event_id: string; person_id: string }> = []) =>
    mockSupabase({
      events: {
        rows: [
          {
            id: 'event-1',
            organization_id: 'org-1',
            start_date: '2026-09-12',
            end_date: '2026-09-13',
          },
        ],
      },
      tournaments: { rows: [{ id: 't-ls', event_id: 'event-1' }] },
      event_referees: { rows: roster },
      event_referee_tournaments: { rows: [] },
      event_referee_days: { rows: [] },
    });
  const service = (supabase: ReturnType<typeof tables>) =>
    new QualificationsService(supabase as never, organizations as never);

  it("asks for the Event organisation's admin, and a refusal writes nothing", async () => {
    const supabase = tables();
    organizations.assertOrgRole.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service(supabase).updateAvailability('event-1', 'lea', { days: [] }, 'actor'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(organizations.assertOrgRole).toHaveBeenCalledWith('org-1', 'actor', 'admin');
    expect(supabase.writes).toEqual([]);
  });

  it('a refused write changes nothing, not even the roster', async () => {
    const supabase = tables();
    await expect(
      service(supabase).updateAvailability(
        'event-1',
        'lea',
        { days: [{ date: '2026-09-14' }] },
        'a',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(supabase.writes).toEqual([]);
  });

  it('adds someone not on the roster yet with a bare row, then stores the ticks', async () => {
    const supabase = tables();
    await service(supabase).updateAvailability(
      'event-1',
      'lea',
      { days: [{ date: '2026-09-12', fromMinute: 540, toMinute: 960 }] },
      'actor',
    );
    expect(writesTo(supabase, 'event_referees')).toEqual([
      {
        table: 'event_referees',
        op: 'insert',
        row: { event_id: 'event-1', person_id: 'lea' },
        filters: [],
      },
    ]);
    expect(writesTo(supabase, 'event_referee_days').map((w) => w.op)).toEqual(['delete', 'insert']);
    expect(writesTo(supabase, 'event_referee_days')[1]!.row).toEqual([
      {
        event_id: 'event-1',
        person_id: 'lea',
        day: '2026-09-12',
        from_minute: 540,
        to_minute: 960,
      },
    ]);
    expect(writesTo(supabase, 'event_referee_tournaments')).toEqual([]);
  });

  it("touches a roster row's timestamp only, never a column that went", async () => {
    const supabase = tables([{ event_id: 'event-1', person_id: 'lea' }]);
    await service(supabase).updateAvailability('event-1', 'lea', { tournamentIds: ['t-ls'] }, 'a');
    const [touched, ...rest] = writesTo(supabase, 'event_referees');
    expect(rest).toEqual([]);
    expect(touched!.op).toBe('update');
    expect(Object.keys(touched!.row as object)).toEqual(['updated_at']);
    expect([scopedTo(touched, 'event_id'), scopedTo(touched, 'person_id')]).toEqual([
      'event-1',
      'lea',
    ]);
    // Ticking the Event's only Tournament is stored as no rows (ruling 145).
    expect(writesTo(supabase, 'event_referee_tournaments').map((w) => w.op)).toEqual(['delete']);
  });

  it('a failed roster read is a plain Error (a 5xx), and writes nothing', async () => {
    const supabase = mockSupabase({
      events: {
        rows: [
          {
            id: 'event-1',
            organization_id: 'org-1',
            start_date: '2026-09-12',
            end_date: '2026-09-13',
          },
        ],
      },
      event_referees: { data: null, error: { message: 'connection reset' } },
    });
    const failure = service(supabase).updateAvailability('event-1', 'lea', { days: [] }, 'a');
    await expect(failure).rejects.toThrow('Could not read the roster row: connection reset');
    await expect(failure).rejects.not.toHaveProperty('status');
    expect(supabase.writes).toEqual([]);
  });
});

describe('QualificationsService.listEventReferees: the ticks as stored', () => {
  it('hands the roster the rows the board reads, with no coalescing (ruling 145)', async () => {
    const supabase = mockSupabase({
      events: { rows: [{ id: 'event-1', organization_id: 'org-1' }] },
      event_referees: { rows: [{ event_id: 'event-1', person_id: 'lea' }] },
      referee_qualifications: { rows: [] },
      global_persons: {
        rows: [
          {
            id: 'lea',
            claimed_by_user_id: null,
            given_name: 'Léa',
            family_name: 'Martin',
            display_name: 'Léa Martin',
            club_id: null,
          },
        ],
      },
      tournaments: { rows: [{ id: 't-ls', event_id: 'event-1', name: 'Longsword' }] },
      phases: { rows: [] },
      event_referee_tournaments: { rows: [] },
      event_referee_days: {
        rows: [
          {
            event_id: 'event-1',
            person_id: 'lea',
            day: '2026-09-14',
            from_minute: null,
            to_minute: null,
          },
        ],
      },
    });
    const organizations = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const [row] = await new QualificationsService(
      supabase as never,
      organizations as never,
    ).listEventReferees('event-1', 'actor');

    // No Tournament ticked = every Tournament; a date the Event no longer holds stays as it is.
    expect(row).toMatchObject({
      tournamentIds: [],
      days: [{ date: '2026-09-14', fromMinute: null, toMinute: null }],
    });
    expect(row).not.toHaveProperty('availableAllTournaments');
    expect(row).not.toHaveProperty('dayIndices');
    expect(selectsFor(supabase.from, 'event_referees')).toEqual(['person_id']);
    expect(selectsFor(supabase.from, 'event_referee_days')).toEqual([
      'person_id, day, from_minute, to_minute',
    ]);
  });
});
