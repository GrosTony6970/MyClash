import { describe, expect, it, vi } from 'vitest';
import { EventsService } from './events.service';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

/** A new Event is stored on the zone its organiser picked, Paris when none (ruling 411 row C). */
describe('EventsService.createEvent — the zone', () => {
  const dto = {
    name: 'FAL 2027',
    slug: 'fal-2027',
    startDate: '2027-03-13',
    endDate: '2027-03-14',
  };

  async function createdRow(timezone?: string) {
    // In call order: no Event holds the slug, then the insert's read-back.
    const db = mockSupabase({
      events: [
        { data: null, error: null },
        { data: { id: 'event-1' }, error: null },
      ],
    });
    const orgs = { assertOrgRole: vi.fn(() => Promise.resolve()) };
    const service = new EventsService(
      db as never,
      orgs as never,
      {} as never,
      createRulesetRegistry(),
    );
    await service.createEvent('org-1', timezone ? { ...dto, timezone } : dto, 'user-7');
    const [insert] = writesTo(db, 'events');
    return insert?.row as Record<string, unknown> | undefined;
  }

  it('stores the zone it was given', async () => {
    expect((await createdRow('America/New_York'))?.['timezone']).toBe('America/New_York');
  });

  it('stores Europe/Paris when no zone was given', async () => {
    expect((await createdRow())?.['timezone']).toBe('Europe/Paris');
  });
});
