import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chain,
  placement,
  mockCreateTournament,
  mockGeneratePools,
  mockSupabaseFrom,
  resetHarness,
  service,
} from './organizer-ai-assistant.harness';

/** A ready `schedule_grid` draft holding one `schedule_match` action. */
const scheduleDraft = (liceId: string, scheduledAt: string) =>
  chain({
    data: {
      id: 'draft-1',
      event_id: 'event-1',
      actor_user_id: 'user-1',
      draft_type: 'schedule_grid',
      status: 'ready',
      proposed_actions_json: [{ kind: 'schedule_match', matchId: 'm-1', liceId, scheduledAt }],
      events: { organization_id: 'org-1' },
    },
  });

/**
 * A Match of this Event. Its update answers with a double of its own, so an
 * assertion on the update's filters cannot pass on the ownership read.
 */
function eventMatch() {
  const update = vi.fn();
  const written = chain({ data: { id: 'm-1' } });
  const matches = chain({ data: { id: 'm-1', phases: { tournaments: { event_id: 'event-1' } } } });
  matches.update = update.mockReturnValue(written);
  return { matches, update, written };
}

/** The in-Event id read (of Lices or Tournaments), awaited after `.in()`, answering with `rows`. */
function idRead(rows: Array<{ id: string }>) {
  const read = Object.assign(Promise.resolve({ data: rows, error: null }), {
    select: vi.fn(() => read),
    eq: vi.fn(() => read),
    in: vi.fn(() => read),
  });
  return read;
}

/** Applying a draft. Creating one is in organizer-ai-assistant.service.test.ts. */
describe('OrganizerAIAssistantService.applyDraft', () => {
  beforeEach(resetHarness);

  it('applies a tournament_config draft through EventsService', async () => {
    mockCreateTournament.mockResolvedValue({ id: 't-created' });
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'organizer_ai_assistant_drafts') {
        const c = chain({
          data: {
            id: 'draft-1',
            event_id: 'event-1',
            actor_user_id: 'user-1',
            draft_type: 'tournament_config',
            status: 'ready',
            proposed_actions_json: [
              {
                kind: 'create_tournament',
                name: 'Longsword Open',
                slug: 'longsword-open',
                weapon: 'longsword',
                category: 'open',
                rulesetCode: 'TF_v1',
              },
            ],
            events: { organization_id: 'org-1' },
          },
          error: null,
        });
        return c;
      }
      if (table === 'audit_log') return chain();
      return chain();
    });

    const result = await service().applyDraft('event-1', 'draft-1', 'user-1');

    expect(mockCreateTournament).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ name: 'Longsword Open', slug: 'longsword-open' }),
      'user-1',
    );
    expect(result.appliedResults).toEqual([
      { kind: 'create_tournament', result: { id: 't-created' } },
    ]);
  });

  it('never lets a draft discard scored results, however it asks', async () => {
    // Every other field in the generate_pools mapper is plumbed straight from
    // the model's output, because the worst a wrong one does is make badly
    // shaped pools somebody regenerates. `discardScoredResults` is different:
    // it accepts the PERMANENT deletion of fought bouts and their exchanges.
    //
    // So the action bag here carries it set to true — the shape a confused or
    // prompt-injected model would emit — and the service must still hand the
    // phases layer `false`. Without this, the hardcoded literal is one careless
    // spread away from becoming plumbing, and the failure mode is a model
    // deleting results with no human in the loop.
    mockGeneratePools.mockResolvedValue({ poolCount: 2 });
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'organizer_ai_assistant_drafts') {
        return chain({
          data: {
            id: 'draft-1',
            event_id: 'event-1',
            actor_user_id: 'user-1',
            draft_type: 'pool_plan',
            status: 'ready',
            proposed_actions_json: [
              {
                kind: 'generate_pools',
                tournamentId: '11111111-1111-4111-8111-111111111111',
                targetSize: 8,
                force: true,
                discardScoredResults: true,
              },
            ],
            events: { organization_id: 'org-1' },
          },
          error: null,
        });
      }
      if (table === 'tournaments') return idRead([{ id: '11111111-1111-4111-8111-111111111111' }]);
      return chain();
    });

    await service().applyDraft('event-1', 'draft-1', 'user-1');

    expect(mockGeneratePools).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ discardScoredResults: false }),
      true,
      'user-1',
    );
  });

  it("refuses to generate pools for another Event's Tournament", async () => {
    // None of the Tournaments named is this Event's.
    const tournaments = idRead([]);
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'tournaments') return tournaments;
      if (table !== 'organizer_ai_assistant_drafts') return chain();
      return chain({
        data: {
          id: 'draft-1',
          event_id: 'event-1',
          actor_user_id: 'user-1',
          draft_type: 'pool_plan',
          status: 'ready',
          proposed_actions_json: [{ kind: 'generate_pools', tournamentId: 't-9', targetSize: 8 }],
          events: { organization_id: 'org-1' },
        },
      });
    });

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toThrow(
      'Every Tournament must belong to this event',
    );
    expect(mockGeneratePools).not.toHaveBeenCalled();
    expect(tournaments.select).toHaveBeenCalledWith('id');
    expect(tournaments.eq).toHaveBeenCalledWith('event_id', 'event-1');
    expect(tournaments.in).toHaveBeenCalledWith('id', ['t-9']);
  });

  it('hands the placement owner the bout, its piste and its time', async () => {
    const { matches } = eventMatch();
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'matches') return matches;
      if (table !== 'organizer_ai_assistant_drafts') return chain();
      return scheduleDraft('l-1', '2026-06-01T09:00:00.000Z');
    });

    const result = await service().applyDraft('event-1', 'draft-1', 'user-1');

    // The Lice check, the occupancy refusal, the write and the alert refresh
    // all live in the placement owner now; this door used to do the write and
    // none of the checking.
    expect(placement.placeMatches).toHaveBeenCalledWith('event-1', [
      { matchId: 'm-1', liceId: 'l-1', scheduledAt: '2026-06-01T09:00:00.000Z' },
    ]);
    // The double answers whatever the projection names. The Match's Event is
    // resolved through this embed, so the string is the proof of the read.
    expect(matches.select).toHaveBeenCalledWith('id, phases(tournaments(event_id))');
    expect(result.appliedResults).toEqual([{ kind: 'schedule_match', result: { id: 'm-1' } }]);
  });

  it('applies nothing when the placement owner refuses', async () => {
    const { matches } = eventMatch();
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'matches') return matches;
      if (table !== 'organizer_ai_assistant_drafts') return chain();
      return scheduleDraft('l-9', '2026-06-01T09:00:00.000Z');
    });
    placement.placeMatches.mockRejectedValueOnce(
      new ConflictException('Piste already busy: this bout overlaps match m-2'),
    );

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toThrow(
      'Piste already busy',
    );
  });

  it('rejects unsafe draft action shapes before apply', async () => {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'organizer_ai_assistant_drafts') {
        return chain({
          data: {
            id: 'draft-1',
            event_id: 'event-1',
            draft_type: 'schedule_grid',
            status: 'ready',
            proposed_actions_json: [{ kind: 'schedule_match', matchId: '', liceId: 'l-1' }],
            events: { organization_id: 'org-1' },
          },
          error: null,
        });
      }
      return chain();
    });

    await expect(service().applyDraft('event-1', 'draft-1', 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
