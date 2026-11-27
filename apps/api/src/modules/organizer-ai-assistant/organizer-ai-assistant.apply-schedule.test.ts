import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chain,
  mockSupabaseFrom,
  placement,
  resetHarness,
  service,
} from './organizer-ai-assistant.harness';

type Placement = { matchId: string; liceId: string; scheduledAt: string };

const PISTE_2 = 'l-2';
const at = (time: string) => `2026-06-01T${time}:00.000Z`;

/**
 * The placement owner, as far as these cases need it: every bout is 30 minutes and starts on the
 * half hour, so two bouts collide when they share a piste and a start. A batch is checked against
 * itself and against the bouts outside it; its own bouts are left out by their old place, as
 * `readOccupants` does. A call without `checkOnly` then writes the batch to `places`.
 */
function board(places: Record<string, string>) {
  placement.placeMatches.mockImplementation(
    async (_eventId: string, batch: Placement[], opts?: { checkOnly?: true }) => {
      const where = (p: Placement) => `${p.liceId} ${p.scheduledAt}`;
      const inBatch = new Set(batch.map((p) => p.matchId));
      const outside = Object.entries(places)
        .filter(([id]) => !inBatch.has(id))
        .map(([, place]) => place);
      const wanted = batch.map(where);
      if (new Set(wanted).size < wanted.length || wanted.some((w) => outside.includes(w))) {
        throw new ConflictException('Piste already busy');
      }
      if (!opts?.checkOnly) for (const p of batch) places[p.matchId] = where(p);
    },
  );
}

/** A ready schedule draft of `moves`, and its Matches at this Event. */
function scheduleDraft(moves: Array<[string, string]>) {
  const actions = moves.map(([matchId, time]) => ({
    kind: 'schedule_match',
    matchId,
    liceId: PISTE_2,
    scheduledAt: at(time),
  }));
  const rows = moves.map(([id]) => ({ id, phases: { tournaments: { event_id: 'event-1' } } }));
  const matches = Object.assign(Promise.resolve({ data: rows, error: null }), {
    select: vi.fn(() => matches),
    in: vi.fn(() => matches),
  });
  const drafts = chain({
    data: {
      id: 'draft-1',
      event_id: 'event-1',
      draft_type: 'schedule_grid',
      status: 'ready',
      proposed_actions_json: actions,
      updated_at: '2026-06-01T08:00:00.000Z',
      events: { organization_id: 'org-1' },
    },
  });
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'matches') return matches;
    return table === 'organizer_ai_assistant_drafts' ? drafts : chain();
  });
  return actions.map(({ matchId, liceId, scheduledAt }) => ({ matchId, liceId, scheduledAt }));
}

/** The calls that wrote: every call to the owner without `checkOnly`. */
const writes = () =>
  placement.placeMatches.mock.calls.filter(
    ([, , opts]) => !(opts as { checkOnly?: true })?.checkOnly,
  );

/**
 * A schedule draft is written whole, in one call to the placement owner, as the schedule board
 * writes a batch. Written one action at a time, a shift or a swap the batch check passed met the
 * next bout at its old place and failed half-way.
 */
describe('OrganizerAIAssistantService.applyDraft, a schedule draft', () => {
  beforeEach(resetHarness);

  it('shifts three bouts on one piste by 30 minutes', async () => {
    // Marie is 30 minutes late on Piste 2.
    board({
      'm-1': `${PISTE_2} ${at('14:00')}`,
      'm-2': `${PISTE_2} ${at('14:30')}`,
      'm-3': `${PISTE_2} ${at('15:00')}`,
    });
    const batch = scheduleDraft([
      ['m-1', '14:30'],
      ['m-2', '15:00'],
      ['m-3', '15:30'],
    ]);

    const result = await service().applyDraft('event-1', 'draft-1', 'user-1');

    expect(writes()).toEqual([['event-1', batch]]);
    expect(result.appliedResults).toEqual(
      ['m-1', 'm-2', 'm-3'].map((id) => ({ kind: 'schedule_match', result: { id } })),
    );
  });

  it('swaps two bouts', async () => {
    board({ 'm-1': `${PISTE_2} ${at('14:00')}`, 'm-2': `${PISTE_2} ${at('14:30')}` });
    const batch = scheduleDraft([
      ['m-1', '14:30'],
      ['m-2', '14:00'],
    ]);

    const result = await service().applyDraft('event-1', 'draft-1', 'user-1');

    expect(placement.placeMatches.mock.calls).toEqual([
      ['event-1', batch, { checkOnly: true }],
      ['event-1', batch],
    ]);
    expect(result).toMatchObject({ status: 'applied' });
  });
});

/** The placement owner's 409 names the other bout by its id, and the page showed its sentence. */
describe('OrganizerAIAssistantService.applyDraft, a schedule draft that collides', () => {
  beforeEach(resetHarness);

  it.each([
    ['the check before the claim', 0],
    ['the write after it', 1],
  ])('is refused at %s in its own words, with no id', async (_when, call) => {
    scheduleDraft([['m-1', '14:30']]);
    const busy = new ConflictException(
      'Piste already busy: this bout overlaps match 0b9c5a52-1d2e-4f3a-8b4c-5d6e7f8a9b0c',
    );
    if (call === 1) placement.placeMatches.mockResolvedValueOnce(undefined);
    placement.placeMatches.mockRejectedValueOnce(busy);

    const refusal = await service()
      .applyDraft('event-1', 'draft-1', 'user-1')
      .catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toEqual({
      code: 'schedule_collision',
      message: 'A bout of this draft overlaps another on its piste.',
    });
    expect(placement.placeMatches).toHaveBeenCalledTimes(call + 1);
  });

  it('leaves a refusal that is not a collision as the owner threw it', async () => {
    scheduleDraft([['m-1', '14:30']]);
    const unreadable = new BadRequestException('Cannot read the time "noon"');
    placement.placeMatches.mockRejectedValueOnce(unreadable);

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toBe(unreadable);
  });
});
