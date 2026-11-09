import { describe, expect, it } from 'vitest';
import { buildAreaColumns, type BoardWorkshop } from '@myclash/schedule-core';
import {
  drawerDragPayload,
  drawerEntries,
  sessionRemovedByDrawerDrop,
  writeDrag,
  type DragPayload,
} from './workshop-drawer';

/**
 * The board's drawer (slice 2.1, rulings 515, 524). "Longsword basics" runs on Saturday; the
 * organiser drags it from the drawer again to add Sunday. The drawer listed only Workshops with no
 * placed session, and its drag named the Workshop's first session, so the drop MOVED Saturday
 * instead of adding Sunday.
 */
const columns = buildAreaColumns([{ id: 'v1', name: 'Main Hall', venue_areas: [] }]);

const longsword: BoardWorkshop = {
  id: 'w-longsword',
  title: 'Longsword basics',
  durationMinutes: 90,
  sessions: [
    {
      id: 's-saturday',
      startsAt: '2027-06-01T08:00:00.000Z',
      endsAt: '2027-06-01T09:00:00.000Z',
      venueId: 'v1',
      areaId: null,
    },
    // Its venue is not on this board: a session to place.
    {
      id: 's-elsewhere',
      startsAt: '2027-06-02T08:00:00.000Z',
      endsAt: '2027-06-02T08:30:00.000Z',
      venueId: 'v-gone',
      areaId: null,
    },
  ],
};
const dagger: BoardWorkshop = {
  id: 'w-dagger',
  title: 'Dagger',
  durationMinutes: null,
  sessions: [],
};

describe('drawerEntries', () => {
  it('lists every Workshop, a placed one too, each followed by its sessions to place', () => {
    const entries = drawerEntries([longsword, dagger], columns);
    expect(
      entries.map((e) => (e.kind === 'workshop' ? [e.workshop.id, e.sessions] : e.session.id)),
    ).toEqual([['w-longsword', 2], 's-elsewhere', ['w-dagger', 0]]);
  });

  it('counts the sessions that run, and still lists a cancelled one to place (ruling 526)', () => {
    const cancelled = {
      ...longsword,
      sessions: longsword.sessions.map((s) => ({ ...s, cancelled: s.id === 's-elsewhere' })),
    };
    const entries = drawerEntries([cancelled], columns);
    expect(
      entries.map((e) => (e.kind === 'workshop' ? [e.workshop.id, e.sessions] : e.session.id)),
    ).toEqual([['w-longsword', 1], 's-elsewhere']);
  });
});

describe('drawerDragPayload', () => {
  const [workshopEntry, sessionEntry] = drawerEntries([longsword], columns);

  it('a Workshop names no session, so the drop adds one, as long as the Workshop runs', () => {
    expect(drawerDragPayload(workshopEntry!)).toEqual({
      workshopId: 'w-longsword',
      sessionId: '',
      span: 18, // 90 min of 5-min slots
      from: 'drawer',
    });
  });

  it('a session to place names itself, as long as it runs', () => {
    expect(drawerDragPayload(sessionEntry!)).toEqual({
      workshopId: 'w-longsword',
      sessionId: 's-elsewhere',
      span: 6, // 30 min
      from: 'drawer',
    });
  });

  it('a Workshop with no length carries an hour', () => {
    const [entry] = drawerEntries([dagger], columns);
    expect(drawerDragPayload(entry!).span).toBe(12);
  });
});

describe('a drop on the drawer', () => {
  const data = (payload: DragPayload) => {
    const store = new Map<string, string>();
    writeDrag(
      { setData: (k: string, v: string) => store.set(k, v) } as unknown as DataTransfer,
      payload,
    );
    return { getData: (k: string) => store.get(k) ?? '' };
  };

  it('removes a card dragged off the grid', () => {
    const drop = data({ workshopId: 'w', sessionId: 's-saturday', span: 12, from: 'grid' });
    expect(sessionRemovedByDrawerDrop(drop)).toBe('s-saturday');
  });

  it('removes nothing for a drag that began in the drawer', () => {
    const [, sessionEntry] = drawerEntries([longsword], columns);
    expect(sessionRemovedByDrawerDrop(data(drawerDragPayload(sessionEntry!)))).toBeNull();
  });
});
