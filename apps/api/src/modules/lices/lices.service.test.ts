import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LicesService } from './lices.service';

/**
 * Table-name dispatch rather than an ordered `mockReturnValueOnce`
 * sequence: the placement guards read `lices`, `venues`, `events` and
 * `venue_areas` in an order that depends on which fields the payload
 * carries, so an ordered queue desyncs per test case.
 */
const reads: Record<string, unknown> = {};
let updatePayload: Record<string, unknown> | null = null;
let insertPayload: Record<string, unknown> | null = null;

function makeChain(table: string) {
  const result = reads[table] ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const key of ['select', 'eq', 'order', 'in']) {
    chain[key] = vi.fn().mockReturnValue(chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);
  chain['update'] = vi.fn((payload: Record<string, unknown>) => {
    updatePayload = payload;
    return chain;
  });
  chain['insert'] = vi.fn((payload: Record<string, unknown>) => {
    insertPayload = payload;
    return chain;
  });
  return chain;
}

const supabase = { service: { from: vi.fn((table: string) => makeChain(table)) } };

const LICE = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';
const VENUE_A = '33333333-3333-4333-8333-333333333333';
const VENUE_B = '44444444-4444-4444-8444-444444444444';
const AREA_IN_A = '55555555-5555-4555-8555-555555555555';

function service() {
  return new LicesService(supabase as never);
}

beforeEach(() => {
  updatePayload = null;
  insertPayload = null;
  for (const key of Object.keys(reads)) delete reads[key];
  reads['lices'] = { data: { event_id: EVENT, venue_id: VENUE_A }, error: null };
  reads['events'] = { data: { organization_id: 'org-1' }, error: null };
  reads['venues'] = { data: { organization_id: 'org-1' }, error: null };
  reads['venue_areas'] = { data: { venue_id: VENUE_A }, error: null };
});

describe('LicesService placement guards', () => {
  it('accepts an area that sits inside the venue the lice already has', async () => {
    await service().update(LICE, { areaId: AREA_IN_A });

    expect(updatePayload).toMatchObject({ area_id: AREA_IN_A });
  });

  it('refuses an area from another venue on an area-only PATCH', async () => {
    // The trap: checking `dto.venueId` alone would wave this through,
    // because an area-only payload names no venue at all.
    reads['venue_areas'] = { data: { venue_id: VENUE_B }, error: null };

    await expect(service().update(LICE, { areaId: AREA_IN_A })).rejects.toThrow(/different venue/i);
  });

  it('checks an incoming area against the venue in the SAME payload, not the stored one', async () => {
    // Moving the lice to venue B and giving it an area that lives in A
    // must fail even though A is the lice's current venue.
    reads['venue_areas'] = { data: { venue_id: VENUE_A }, error: null };

    await expect(service().update(LICE, { venueId: VENUE_B, areaId: AREA_IN_A })).rejects.toThrow(
      /different venue/i,
    );
  });

  it('refuses an area on a lice that has no venue', async () => {
    reads['lices'] = { data: { event_id: EVENT, venue_id: null }, error: null };

    await expect(service().update(LICE, { areaId: AREA_IN_A })).rejects.toThrow(/has a venue/i);
  });

  it('clears the area when the venue is detached, even unasked', async () => {
    await service().update(LICE, { venueId: null });

    expect(updatePayload).toMatchObject({ venue_id: null, area_id: null });
  });

  it('lets the caller clear the area on its own', async () => {
    await service().update(LICE, { areaId: null });

    expect(updatePayload).toMatchObject({ area_id: null });
  });

  it('leaves placement untouched when the payload names neither field', async () => {
    await service().update(LICE, { name: 'Piste 2' });

    expect(updatePayload).toEqual({ name: 'Piste 2' });
  });

  it('persists the area on create', async () => {
    await service().create(EVENT, { name: 'Piste 1', venueId: VENUE_A, areaId: AREA_IN_A });

    expect(insertPayload).toMatchObject({ venue_id: VENUE_A, area_id: AREA_IN_A });
  });

  it('refuses a create whose area belongs to a different venue', async () => {
    reads['venue_areas'] = { data: { venue_id: VENUE_B }, error: null };

    await expect(
      service().create(EVENT, { name: 'Piste 1', venueId: VENUE_A, areaId: AREA_IN_A }),
    ).rejects.toThrow(/different venue/i);
  });
});
