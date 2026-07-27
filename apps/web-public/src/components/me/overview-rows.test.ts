import { describe, expect, it } from 'vitest';
import { buildCompetingRows, buildRefereeRows, competingStart } from './overview-rows';
import type { MyEventRefereeOf, MyEventTournament, ScheduleMatch } from './types';

const ref = (over: Partial<MyEventRefereeOf> = {}): MyEventRefereeOf => ({
  id: over.id ?? 'a1',
  tournamentName: over.tournamentName ?? 'Longsword Open',
  poolName: over.poolName ?? null,
  role: over.role ?? null,
  skillName: over.skillName ?? null,
  skillColor: over.skillColor ?? null,
  liceName: over.liceName ?? null,
  venueName: over.venueName ?? null,
  matchKind: over.matchKind ?? null,
  roundOfCount: over.roundOfCount ?? null,
  bracketSlotId: over.bracketSlotId ?? null,
  startsAt: over.startsAt ?? null,
  endsAt: over.endsAt ?? null,
});

const tourn = (over: Partial<MyEventTournament> = {}): MyEventTournament => ({
  id: over.id ?? 't1',
  slug: over.slug ?? 'longsword-open',
  name: over.name ?? 'Longsword Open',
  weapon: over.weapon ?? null,
  registered: over.registered ?? true,
  registrationId: over.registrationId ?? null,
  poolName: over.poolName ?? null,
  seed: over.seed ?? null,
  bibNumber: over.bibNumber ?? null,
});

const match = (over: Partial<ScheduleMatch> = {}): ScheduleMatch => ({
  id: over.id ?? 'm1',
  matchNumberLabel: over.matchNumberLabel ?? 'M1',
  status: over.status ?? 'scheduled',
  scheduledAt: over.scheduledAt ?? null,
  opponentName: over.opponentName ?? null,
  redScore: over.redScore ?? 0,
  blueScore: over.blueScore ?? 0,
  isRed: over.isRed ?? true,
  poolName: over.poolName ?? null,
  tournamentName: over.tournamentName ?? 'Longsword Open',
  tournamentId: over.tournamentId ?? null,
  phase: over.phase ?? null,
  liceName: over.liceName ?? null,
});

describe('buildRefereeRows', () => {
  it('orders duties chronologically regardless of arrival order', () => {
    // Mirrors the reported bug: a 13:21 quarter-final arriving before a 09:11 one.
    const rows = buildRefereeRows(
      [
        ref({ id: 'qf-late', startsAt: '2027-05-23T13:21:00Z' }),
        ref({ id: 'pool', startsAt: '2027-05-22T13:00:00Z' }),
        ref({ id: 'qf-early', startsAt: '2027-05-23T09:11:00Z' }),
      ],
      [],
    );
    expect(rows.map((r) => r.id)).toEqual(['pool', 'qf-early', 'qf-late']);
  });

  it('puts unscheduled duties last', () => {
    const rows = buildRefereeRows(
      [ref({ id: 'tbd', startsAt: null }), ref({ id: 'dated', startsAt: '2027-05-23T09:00:00Z' })],
      [],
    );
    expect(rows.map((r) => r.id)).toEqual(['dated', 'tbd']);
  });

  it('breaks a shared start on end time, then tournament name', () => {
    const at = '2027-05-23T09:00:00Z';
    const rows = buildRefereeRows(
      [
        ref({ id: 'c', startsAt: at, endsAt: '2027-05-23T10:00:00Z', tournamentName: 'Sabre' }),
        ref({ id: 'b', startsAt: at, endsAt: '2027-05-23T09:30:00Z', tournamentName: 'Sabre' }),
        ref({ id: 'a', startsAt: at, endsAt: '2027-05-23T09:30:00Z', tournamentName: 'Rapier' }),
      ],
      [],
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('resolves the tournament by name and leaves an unknown name null', () => {
    const longsword = tourn({ id: 't-ls', name: 'Longsword Open', slug: 'ls' });
    const rows = buildRefereeRows(
      [
        ref({ id: 'known', tournamentName: 'Longsword Open', startsAt: '2027-05-23T09:00:00Z' }),
        ref({ id: 'orphan', tournamentName: 'Deleted Open', startsAt: '2027-05-23T10:00:00Z' }),
      ],
      [longsword],
    );
    expect(rows.map((r) => r.tournament?.slug ?? null)).toEqual(['ls', null]);
  });

  it('returns an empty list when there is nothing to show', () => {
    expect(buildRefereeRows([], [])).toEqual([]);
  });
});

describe('competingStart', () => {
  it('picks the earliest match of that tournament only', () => {
    const start = competingStart(tourn({ name: 'Longsword Open' }), [
      match({ tournamentName: 'Sidesword Open', scheduledAt: '2027-05-22T08:00:00Z' }),
      match({ tournamentName: 'Longsword Open', scheduledAt: '2027-05-22T11:00:00Z' }),
      match({ tournamentName: 'Longsword Open', scheduledAt: '2027-05-22T09:30:00Z' }),
    ]);
    expect(start).toBe('2027-05-22T09:30:00Z');
  });

  it('ignores unscheduled matches and returns null when none are dated', () => {
    expect(competingStart(tourn(), [match({ scheduledAt: null })])).toBeNull();
  });
});

describe('buildCompetingRows', () => {
  const ls = tourn({ id: 't-ls', name: 'Longsword Open' });
  const ss = tourn({ id: 't-ss', name: 'Sidesword Open' });

  it('orders registered tournaments by their first match', () => {
    const rows = buildCompetingRows(
      [ls, ss],
      [
        match({ tournamentName: 'Longsword Open', scheduledAt: '2027-05-23T09:00:00Z' }),
        match({ tournamentName: 'Sidesword Open', scheduledAt: '2027-05-22T13:00:00Z' }),
      ],
    );
    expect(rows.map((tr) => tr.id)).toEqual(['t-ss', 't-ls']);
  });

  it('drops tournaments the user is not registered in', () => {
    const rows = buildCompetingRows([ls, tourn({ id: 't-no', registered: false })], []);
    expect(rows.map((tr) => tr.id)).toEqual(['t-ls']);
  });

  it('sorts unscheduled tournaments last, alphabetically among themselves', () => {
    const rapier = tourn({ id: 't-rp', name: 'Rapier Open' });
    const rows = buildCompetingRows(
      [ss, rapier, ls],
      [match({ tournamentName: 'Sidesword Open', scheduledAt: '2027-05-22T13:00:00Z' })],
    );
    expect(rows.map((tr) => tr.id)).toEqual(['t-ss', 't-ls', 't-rp']);
  });

  it('falls back to alphabetical before the schedule fetch resolves', () => {
    expect(buildCompetingRows([ss, ls], []).map((tr) => tr.id)).toEqual(['t-ls', 't-ss']);
  });

  it('does not mutate the input array', () => {
    const input = [ss, ls];
    buildCompetingRows(input, []);
    expect(input.map((tr) => tr.id)).toEqual(['t-ss', 't-ls']);
  });
});
