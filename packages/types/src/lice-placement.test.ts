import { describe, expect, it } from 'vitest';
import { groupLicesByPlacement, mapHubLice, placementLabel, type HubLice } from './lice-placement';

function lice(over: Partial<HubLice> & { id: string; name: string }): HubLice {
  return { sortOrder: 0, venue: null, area: null, ...over };
}

const HALL = { id: 'v-1', name: 'Grande Salle' };
const ANNEX = { id: 'v-2', name: 'Annexe' };
const MAT_A = { id: 'a-1', name: 'Mat A' };
const MAT_B = { id: 'a-2', name: 'Mat B' };

describe('mapHubLice', () => {
  it('reads a venue and area returned as objects', () => {
    const mapped = mapHubLice({
      id: 'l-1',
      name: 'Piste 1',
      sort_order: 2,
      venues: HALL,
      venue_areas: MAT_A,
    });

    expect(mapped).toEqual({
      id: 'l-1',
      name: 'Piste 1',
      sortOrder: 2,
      venue: HALL,
      area: MAT_A,
    });
  });

  it('reads the same embed returned as a single-element array', () => {
    // PostgREST has flipped an embed from object to array before, when a
    // UNIQUE constraint moved. Both shapes have to land the same way.
    const mapped = mapHubLice({
      id: 'l-1',
      name: 'Piste 1',
      venues: [HALL],
      venue_areas: [MAT_A],
    });

    expect(mapped?.venue).toEqual(HALL);
    expect(mapped?.area).toEqual(MAT_A);
  });

  it('treats a missing or empty embed as unplaced', () => {
    const mapped = mapHubLice({ id: 'l-1', name: 'Piste 1', venues: null, venue_areas: [] });

    expect(mapped?.venue).toBeNull();
    expect(mapped?.area).toBeNull();
  });

  it('drops a row with no name — the kiosk route is keyed by name', () => {
    expect(mapHubLice({ id: 'l-1', name: '' })).toBeNull();
    expect(mapHubLice({ id: '', name: 'Piste 1' })).toBeNull();
  });

  it('defaults a missing sort_order to 0 rather than NaN', () => {
    expect(mapHubLice({ id: 'l-1', name: 'Piste 1' })?.sortOrder).toBe(0);
  });
});

describe('groupLicesByPlacement', () => {
  it('splits one venue into a group per area', () => {
    const groups = groupLicesByPlacement([
      lice({ id: 'l-1', name: 'Piste 1', venue: HALL, area: MAT_A }),
      lice({ id: 'l-2', name: 'Piste 2', venue: HALL, area: MAT_B }),
    ]);

    expect(groups.map((g) => [g.venueName, g.areaName])).toEqual([
      ['Grande Salle', 'Mat A'],
      ['Grande Salle', 'Mat B'],
    ]);
  });

  it('keeps parallel venues apart', () => {
    const groups = groupLicesByPlacement([
      lice({ id: 'l-3', name: 'Piste 3', venue: ANNEX }),
      lice({ id: 'l-1', name: 'Piste 1', venue: HALL }),
    ]);

    expect(groups.map((g) => g.venueName)).toEqual(['Annexe', 'Grande Salle']);
    expect(groups[1]?.lices.map((l) => l.name)).toEqual(['Piste 1']);
  });

  it('collects unplaced lices into ONE trailing group', () => {
    const groups = groupLicesByPlacement([
      lice({ id: 'l-9', name: 'Piste 9' }),
      lice({ id: 'l-1', name: 'Piste 1', venue: HALL }),
      lice({ id: 'l-8', name: 'Piste 8' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[1]?.venueName).toBeNull();
    expect(groups[1]?.lices.map((l) => l.name)).toEqual(['Piste 8', 'Piste 9']);
  });

  it('orders within a group by sort_order, names breaking ties', () => {
    const groups = groupLicesByPlacement([
      lice({ id: 'l-b', name: 'Bravo', venue: HALL, sortOrder: 1 }),
      lice({ id: 'l-c', name: 'Charlie', venue: HALL, sortOrder: 0 }),
      lice({ id: 'l-a', name: 'Alpha', venue: HALL, sortOrder: 0 }),
    ]);

    expect(groups[0]?.lices.map((l) => l.name)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it('returns a single group for a single-hall event, so the page can drop the heading', () => {
    const groups = groupLicesByPlacement([
      lice({ id: 'l-1', name: 'Piste 1', venue: HALL }),
      lice({ id: 'l-2', name: 'Piste 2', venue: HALL }),
    ]);

    expect(groups).toHaveLength(1);
  });

  it('ignores an area on a lice with no venue rather than heading a phantom hall', () => {
    const groups = groupLicesByPlacement([lice({ id: 'l-1', name: 'Piste 1', area: MAT_A })]);

    expect(groups[0]?.venueName).toBeNull();
    expect(groups[0]?.areaName).toBeNull();
  });

  it('returns nothing for an event with no lices', () => {
    expect(groupLicesByPlacement([])).toEqual([]);
  });
});

describe('placementLabel', () => {
  it('joins a venue and an area', () => {
    expect(placementLabel('Grande Salle', 'Mat A')).toBe('Grande Salle — Mat A');
  });

  it('falls back to whichever one exists', () => {
    expect(placementLabel('Grande Salle', null)).toBe('Grande Salle');
    expect(placementLabel(null, 'Mat A')).toBe('Mat A');
  });

  it('is null when nothing is known', () => {
    expect(placementLabel(null, null)).toBeNull();
  });
});
