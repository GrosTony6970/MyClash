import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { StaffService } from './staff.service';
import { filtersFor, mockSupabase } from '../../common/testing/supabase-chain';

/**
 * The public piste display — the endpoint a venue TV points at.
 *
 * No session, no organiser, no staff cookie: it takes an event slug and a piste
 * NAME off the URL and answers with whatever is on that piste. Piste names are
 * unique per event, not globally, so `Piste 1` exists at every event in the
 * database. The `.eq('event_id', …)` in front of the name match is the only
 * thing keeping one venue's screen off another venue's bout.
 *
 * Nothing executed this method before this file.
 *
 * That lookup is `.eq(event_id).ilike(name)` in a single query, and the double
 * refuses `ilike` on a seeded table rather than quietly returning every row — so
 * `lices` is a per-table QUEUE here (the name lookup, then the read-back by id
 * inside getCurrentForLiceId) and the two filters are argument assertions. What
 * the endpoint RETURNS is asserted from the seeded `matches` table.
 */

const EVENT = 'event-1';
const OTHER_EVENT = 'event-2';
const LICE = 'lice-1';

const eventRow = (id: string) => ({
  id,
  organization_id: 'org-1',
  slug: `slug-${id}`,
  name: `Event ${id}`,
  status: 'running',
  start_date: '2026-08-08',
  end_date: '2099-12-31',
});

function build(matches: Array<Record<string, unknown>>) {
  const supabase = mockSupabase({
    events: { rows: [eventRow(OTHER_EVENT), eventRow(EVENT)] },
    lices: [
      { data: { id: LICE, name: 'Piste 1' }, error: null },
      {
        data: {
          id: LICE,
          name: 'Piste 1',
          event_id: EVENT,
          events: { id: EVENT, slug: `slug-${EVENT}`, name: 'FAL', status: 'running' },
        },
        error: null,
      },
    ],
    matches: { rows: matches },
  });
  const service = new StaffService(supabase as never, {} as never, {} as never, {} as never);
  return { service, supabase };
}

describe('StaffService.getPublicLiceCurrent', () => {
  it('looks the piste up by name WITHIN the event the slug resolved to', async () => {
    const { service, supabase } = build([]);

    await service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1');

    // Routed by table, not by call index: `lices` is read twice here, and an
    // index would quietly follow whichever read moved.
    expect(filtersFor(supabase.from, 'lices', 'eq')).toContainEqual(['event_id', EVENT]);
    expect(filtersFor(supabase.from, 'lices', 'ilike')).toContainEqual(['name', 'Piste 1']);
  });

  it('answers with the bout running on that piste', async () => {
    const { service } = build([
      { id: 'match-here', lice_id: LICE, status: 'running', scheduled_at: '2026-08-08T09:00:00Z' },
    ]);

    const result = (await service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1')) as {
      liceId: string;
      current: { id: string } | null;
    };

    expect(result.liceId).toBe(LICE);
    expect(result.current?.id).toBe('match-here');
  });

  it('refuses an event slug that does not exist rather than falling back to one', async () => {
    const { service } = build([]);

    await expect(service.getPublicLiceCurrent('slug-nowhere', 'Piste 1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
