import { describe, expect, it } from 'vitest';
import { withFighterStatusCauses } from './archive-fighter-status';

/**
 * An archive made before migration 0240 carries each Fighter's status and none of the columns it
 * is now worked out from. On restore they are filled from the archive alone, each only where a row
 * lacks it. The restore settles nobody: the status is kept as archived, and the filled columns are
 * what a later settle reads.
 */
const RESTORED_AT = '2026-10-21T12:00:00.000Z';

const reg = (id: string, status: string) => ({ id, tournament_id: 't1', status });
const forfeit = (id: string, over: Record<string, unknown>) => ({
  id,
  match_id: `m-${id}`,
  tournament_id: 't1',
  forfeiting_registration_id: 'ana',
  reason: 'injury',
  parent_forfeit_id: null,
  auto_created: false,
  can_continue: true,
  voided_at: null,
  created_at: '2026-10-01T10:00:00.000Z',
  ...over,
});
const card = (over: Record<string, unknown> = {}) => ({
  id: 'card-1',
  registration_id: 'ana',
  card: 'black',
  voided: false,
  ...over,
});

function filled(tables: {
  registrations?: Record<string, unknown>[];
  matchForfeits?: Record<string, unknown>[];
  matchPenalties?: Record<string, unknown>[];
  tournamentPenaltyReviews?: Record<string, unknown>[];
}) {
  return withFighterStatusCauses(
    {
      registrations: tables.registrations ?? [],
      matchForfeits: tables.matchForfeits ?? [],
      matchPenalties: tables.matchPenalties ?? [],
      tournamentPenaltyReviews: tables.tournamentPenaltyReviews ?? [],
    },
    RESTORED_AT,
  );
}

const outcomes = (data: ReturnType<typeof filled>) =>
  Object.fromEntries(data.matchForfeits.map((row) => [row['id'], row['fighter_outcome']]));
const fighter = (data: ReturnType<typeof filled>, id = 'ana') =>
  data.registrations.find((row) => row['id'] === id);

describe('the Fighters of an archive made before 0240', () => {
  it('a Fighter in keeps the status as the hand, and has no spell out', () => {
    const data = filled({ registrations: [reg('ana', 'checked_in'), reg('bo', 'waitlist')] });
    expect(fighter(data)).toMatchObject({ entry_status: 'checked_in', out_since: null });
    expect(fighter(data, 'bo')).toMatchObject({ entry_status: 'waitlist', out_since: null });
  });

  it('withdrawn with no forfeit of their own: the organiser’s hand, out since the restore', () => {
    const data = filled({ registrations: [reg('ana', 'withdrawn')] });
    expect(fighter(data)).toMatchObject({ entry_status: 'withdrawn', out_since: RESTORED_AT });
  });

  it('withdrawn by a forfeit: that forfeit withdrew them, out since the oldest bout forfeited with it', () => {
    const data = filled({
      registrations: [reg('ana', 'withdrawn')],
      matchForfeits: [
        forfeit('root', { can_continue: false }),
        forfeit('child-2', {
          auto_created: true,
          parent_forfeit_id: 'root',
          can_continue: false,
          created_at: '2026-10-01T10:00:02.000Z',
        }),
        forfeit('child-1', {
          auto_created: true,
          parent_forfeit_id: 'root',
          can_continue: false,
          created_at: '2026-10-01T10:00:01.000Z',
        }),
      ],
    });
    expect(outcomes(data)).toEqual({ root: 'withdrawn', 'child-2': null, 'child-1': null });
    expect(fighter(data)).toMatchObject({
      entry_status: 'checked_in',
      out_since: '2026-10-01T10:00:01.000Z',
    });
  });

  it('disqualified by a forfeit nothing else explains: stored on it, out since it', () => {
    const data = filled({
      registrations: [reg('ana', 'disqualified')],
      matchForfeits: [forfeit('conduct', { reason: 'conduct_violation', can_continue: false })],
    });
    expect(outcomes(data)).toEqual({ conduct: 'disqualified' });
    expect(fighter(data)).toMatchObject({
      entry_status: 'checked_in',
      out_since: '2026-10-01T10:00:00.000Z',
    });
  });

  it('a disqualifying forfeit recorded under a withdrawal is the latest, and stored (ruling 112)', () => {
    const data = filled({
      registrations: [reg('ana', 'disqualified')],
      matchForfeits: [
        forfeit('root', { can_continue: false }),
        forfeit('under', {
          reason: 'conduct_violation',
          parent_forfeit_id: 'root',
          created_at: '2026-10-01T11:00:00.000Z',
        }),
      ],
    });
    expect(outcomes(data)).toEqual({ root: 'withdrawn', under: 'disqualified' });
  });

  it.each<[string, Parameters<typeof filled>[0]]>([
    ['a live black card', { matchPenalties: [card()] }],
    [
      'a confirmed review',
      { tournamentPenaltyReviews: [{ id: 'rv', registration_id: 'ana', status: 'confirmed' }] },
    ],
    [
      'a 2nd live forfeit they chose ("disqualify after N")',
      { matchForfeits: [forfeit('first', { created_at: '2026-10-01T09:00:00.000Z' })] },
    ],
  ])('disqualified when %s could explain it: no forfeit is stored as the cause', (_why, more) => {
    const data = filled({
      registrations: [reg('ana', 'disqualified')],
      ...more,
      matchForfeits: [...(more.matchForfeits ?? []), forfeit('last', { reason: 'voluntary' })],
    });
    expect(outcomes(data)['last']).toBeNull();
    expect(fighter(data)).toMatchObject({ entry_status: 'checked_in', out_since: RESTORED_AT });
  });

  it('a voided card explains nothing', () => {
    const data = filled({
      registrations: [reg('ana', 'disqualified')],
      matchPenalties: [card({ voided: true })],
      matchForfeits: [forfeit('conduct', { reason: 'conduct_violation' })],
    });
    expect(outcomes(data)).toEqual({ conduct: 'disqualified' });
  });

  it('stores nothing on a voided forfeit, one its black card sent, or an override', () => {
    const data = filled({
      registrations: [reg('ana', 'disqualified')],
      // The card door wrote its card on the bout first.
      matchPenalties: [card({ match_id: 'm-card' })],
      matchForfeits: [
        forfeit('voided', { can_continue: false, voided_at: '2026-10-02T10:00:00.000Z' }),
        forfeit('card', { reason: 'black_card_2', can_continue: false }),
        forfeit('override', { reason: 'admin_correction', can_continue: false }),
      ],
    });
    expect(outcomes(data)).toEqual({ voided: null, card: null, override: null });
  });

  it('a black card forfeit recorded by hand, with no card on its bout, is its own cause', () => {
    const data = filled({
      registrations: [reg('ana', 'disqualified')],
      matchForfeits: [forfeit('card', { reason: 'black_card_2', can_continue: false })],
    });
    expect(outcomes(data)).toEqual({ card: 'disqualified' });
  });
});

describe('the reviews of an archive made before 0240', () => {
  it('a confirmed review answered the cards it counted; any other review is left as it is', () => {
    const data = filled({
      tournamentPenaltyReviews: [
        { id: 'confirmed', status: 'confirmed', payload_json: { penaltyIds: ['c1', 'c2'] } },
        { id: 'pending', status: 'pending', payload_json: { penaltyIds: ['c1', 'c2'] } },
      ],
    });
    expect(data.tournamentPenaltyReviews.map((row) => row['payload_json'])).toEqual([
      { penaltyIds: ['c1', 'c2'], answeredPenaltyIds: ['c1', 'c2'] },
      { penaltyIds: ['c1', 'c2'] },
    ]);
  });
});

describe('an archive made since 0240', () => {
  it('keeps every row that carries its columns as it is', () => {
    const own = {
      registrations: [{ ...reg('ana', 'withdrawn'), entry_status: 'checked_in', out_since: 'x' }],
      matchForfeits: [forfeit('root', { can_continue: false, fighter_outcome: null })],
      tournamentPenaltyReviews: [
        {
          id: 'rv',
          status: 'confirmed',
          payload_json: { penaltyIds: ['c1'], answeredPenaltyIds: [] },
        },
      ],
    };
    const data = filled(own);
    expect(data.registrations).toEqual(own.registrations);
    expect(data.matchForfeits).toEqual(own.matchForfeits);
    expect(data.tournamentPenaltyReviews).toEqual(own.tournamentPenaltyReviews);
  });
});
