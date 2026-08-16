import { describe, expect, it } from 'vitest';
import { findLiceCollisions, liceCollisionMessage } from './lice-occupancy';

const at = (hhmm: string) => `2026-05-21T${hhmm}:00.000Z`;

describe('findLiceCollisions', () => {
  it('reports two bouts overlapping on one piste', () => {
    const collisions = findLiceCollisions(
      [{ matchId: 'm-new', liceId: 'lice-1', scheduledAt: at('10:00') }],
      [{ matchId: 'm-old', liceId: 'lice-1', scheduledAt: at('10:02') }],
    );

    expect(collisions).toEqual([
      { liceId: 'lice-1', matchId: 'm-new', conflictingMatchId: 'm-old' },
    ]);
  });

  it('reports a clash between two tournaments, which share no fighter', () => {
    // The gap this exists to close. The grid's banner tests time overlap only
    // AFTER finding a shared registration, so two tournaments on one piste
    // reported nothing at all.
    const collisions = findLiceCollisions(
      [{ matchId: 'longsword-1', liceId: 'lice-2', scheduledAt: at('14:00') }],
      [{ matchId: 'sidesword-7', liceId: 'lice-2', scheduledAt: at('14:00') }],
    );

    expect(collisions).toHaveLength(1);
  });

  it('allows back-to-back bouts — touching is not overlapping', () => {
    // Half-open intervals. A piste running 10:00, 10:05, 10:10 is the normal
    // case; refusing it would refuse every schedule the generator produces.
    const collisions = findLiceCollisions(
      [{ matchId: 'm-2', liceId: 'lice-1', scheduledAt: at('10:05') }],
      [{ matchId: 'm-1', liceId: 'lice-1', scheduledAt: at('10:00') }],
    );

    expect(collisions).toEqual([]);
  });

  it('ignores a different piste at the same moment', () => {
    const collisions = findLiceCollisions(
      [{ matchId: 'm-2', liceId: 'lice-2', scheduledAt: at('10:00') }],
      [{ matchId: 'm-1', liceId: 'lice-1', scheduledAt: at('10:00') }],
    );

    expect(collisions).toEqual([]);
  });

  it('ignores a placement with no piste or no time', () => {
    const occupants = [{ matchId: 'm-1', liceId: 'lice-1', scheduledAt: at('10:00') }];

    expect(
      findLiceCollisions([{ matchId: 'm-2', liceId: null, scheduledAt: at('10:00') }], occupants),
    ).toEqual([]);
    expect(
      findLiceCollisions([{ matchId: 'm-2', liceId: 'lice-1', scheduledAt: null }], occupants),
    ).toEqual([]);
  });

  it('never collides a bout with its own former placement', () => {
    // Re-saving a bout where it already sits must not refuse. Callers exclude
    // the moving rows from `occupants`, and this is the belt to that braces.
    const collisions = findLiceCollisions(
      [{ matchId: 'm-1', liceId: 'lice-1', scheduledAt: at('10:00') }],
      [{ matchId: 'm-1', liceId: 'lice-1', scheduledAt: at('10:00') }],
    );

    expect(collisions).toEqual([]);
  });

  it('catches a multi-row write colliding with ITSELF', () => {
    // The half a purely outward-looking check would miss: a pool re-timed onto
    // one piste can land two of its own bouts on the same slot without any
    // pre-existing occupant being involved.
    const collisions = findLiceCollisions(
      [
        { matchId: 'm-1', liceId: 'lice-1', scheduledAt: at('10:00') },
        { matchId: 'm-2', liceId: 'lice-1', scheduledAt: at('10:03') },
      ],
      [],
    );

    expect(collisions).toEqual([{ liceId: 'lice-1', matchId: 'm-1', conflictingMatchId: 'm-2' }]);
  });

  it('reports a colliding pair once, not twice', () => {
    const collisions = findLiceCollisions(
      [
        { matchId: 'm-1', liceId: 'lice-1', scheduledAt: at('10:00') },
        { matchId: 'm-2', liceId: 'lice-1', scheduledAt: at('10:01') },
        { matchId: 'm-3', liceId: 'lice-1', scheduledAt: at('10:02') },
      ],
      [],
    );

    // 3 mutually overlapping bouts = 3 pairs, not 6 directed reports.
    expect(collisions).toHaveLength(3);
  });

  it('honours an explicit duration', () => {
    const long = [
      { matchId: 'm-1', liceId: 'lice-1', scheduledAt: at('10:00'), durationMinutes: 30 },
    ];

    expect(
      findLiceCollisions([{ matchId: 'm-2', liceId: 'lice-1', scheduledAt: at('10:20') }], long),
    ).toHaveLength(1);
    expect(
      findLiceCollisions([{ matchId: 'm-2', liceId: 'lice-1', scheduledAt: at('10:30') }], long),
    ).toEqual([]);
  });

  it('survives an unparseable timestamp instead of colliding with everything', () => {
    // NaN arithmetic makes every comparison false, which would silently PASS a
    // bad placement. Dropping it is the same outcome, reached on purpose.
    const collisions = findLiceCollisions(
      [{ matchId: 'm-2', liceId: 'lice-1', scheduledAt: 'not-a-date' }],
      [{ matchId: 'm-1', liceId: 'lice-1', scheduledAt: at('10:00') }],
    );

    expect(collisions).toEqual([]);
  });
});

describe('liceCollisionMessage', () => {
  it('names the bout it clashes with', () => {
    const message = liceCollisionMessage([
      { liceId: 'lice-1', matchId: 'm-2', conflictingMatchId: 'm-1' },
    ]);

    expect(message).toContain('m-1');
  });

  it('says how many more when a batch collides in several places', () => {
    const message = liceCollisionMessage([
      { liceId: 'lice-1', matchId: 'm-2', conflictingMatchId: 'm-1' },
      { liceId: 'lice-1', matchId: 'm-3', conflictingMatchId: 'm-1' },
    ]);

    expect(message).toContain('1 more');
  });
});
