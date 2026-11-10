/**
 * The two Workshop audiences of an organiser's broadcast (operator rulings 533, 534).
 *
 * The Open runs "Longsword basics" (Saturday cancelled, Sunday running) and a draft "Sabre" on
 * Monday. Claire broadcasts "The bar opens at 18:00" to the Workshop attendees: Alice (a seat on
 * Sunday), Bob (waiting on Sunday) and Eve (a seat in the draft Workshop) are told. Carl's seat was
 * on the cancelled Saturday and Dan was refused: neither is told.
 *
 * Then "Meet at 9:00" to the instructors: Marie, tagged as an instructor of the Open on the Persons
 * page and on no Workshop yet; Paul, who teaches Longsword and has no roster row in the Open (told
 * through his account); Zoé, tagged AND teaching (told once). An instructor typed as a name only
 * cannot be told, and the log says so. The instructor of another Event's Workshop is not told.
 *
 * Driven through the real service over seeded tables, so every filter is applied.
 */
import { BadRequestException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { BroadcastNotificationsService } from './broadcast-notifications.service';

const OPEN = 'e-open';

const person = (name: string, globalPersonId: string | null = null) => ({
  id: `p-${name}`,
  event_id: OPEN,
  global_person_id: globalPersonId,
  claimed_by_user_id: `u-${name}`,
  email: `${name}@roster.example`,
});
const booking = (person: string, session: string, status: string) => ({
  id: `e-${person}-${session}`,
  user_id: `p-${person}`,
  workshop_session_id: session,
  status,
});

/** The Open's Workshops, their sessions and bookings, and one Workshop of another Event. */
const WORKSHOP_TABLES = {
  workshops: {
    rows: [
      { id: 'w-long', event_id: OPEN, status: 'published' },
      { id: 'w-sabre', event_id: OPEN, status: 'draft' },
      { id: 'w-elsewhere', event_id: 'e-other', status: 'published' },
    ],
  },
  workshop_sessions: {
    rows: [
      { id: 's-sat', workshop_id: 'w-long', status: 'cancelled' },
      { id: 's-sun', workshop_id: 'w-long', status: 'scheduled' },
      { id: 's-mon', workshop_id: 'w-sabre', status: 'scheduled' },
      { id: 's-other', workshop_id: 'w-elsewhere', status: 'scheduled' },
    ],
  },
  workshop_enrollments: {
    rows: [
      booking('carl', 's-sat', 'confirmed'),
      booking('alice', 's-sun', 'confirmed'),
      booking('dan', 's-sun', 'refused'),
      booking('bob', 's-sun', 'waitlisted'),
      booking('eve', 's-mon', 'confirmed'),
      booking('olga', 's-other', 'confirmed'),
    ],
  },
} satisfies Record<string, TableSeed>;

/** Who teaches: tagged on the Event, named on a Workshop, or both. */
const INSTRUCTOR_TABLES = {
  event_instructors: {
    rows: [
      { event_id: OPEN, person_id: 'gp-marie' },
      { event_id: OPEN, person_id: 'gp-zoe' },
      { event_id: 'e-other', person_id: 'gp-xavier' },
    ],
  },
  workshop_instructors: {
    rows: [
      { workshop_id: 'w-long', global_person_id: 'gp-paul' },
      { workshop_id: 'w-long', global_person_id: 'gp-zoe' },
      { workshop_id: 'w-long', global_person_id: null },
      { workshop_id: 'w-elsewhere', global_person_id: 'gp-xavier' },
    ],
  },
} satisfies Record<string, TableSeed>;

function tables(over: Record<string, TableSeed> = {}) {
  return {
    events: { rows: [{ id: OPEN, organization_id: 'o-lyon', slug: 'open', name: 'Open' }] },
    ...WORKSHOP_TABLES,
    ...INSTRUCTOR_TABLES,
    persons: {
      rows: [
        person('alice'),
        person('bob'),
        person('carl'),
        person('dan'),
        person('eve'),
        person('marie', 'gp-marie'),
        person('zoe', 'gp-zoe'),
      ],
    },
    global_persons: {
      rows: [
        { id: 'gp-paul', claimed_by_user_id: 'u-paul' },
        { id: 'gp-xavier', claimed_by_user_id: 'u-xavier' },
      ],
    },
    event_broadcast_notifications: { rows: [], returning: { id: 'b-1' } },
    event_broadcast_recipients: {
      rows: [],
      returning: (_row: SupabaseRow, at: number) => ({ id: `r-${at + 1}` }),
    },
    audit_log: { rows: [] },
    ...over,
  } satisfies Record<string, TableSeed>;
}

const rpc = vi.fn();
const scheduler = { sendImmediate: vi.fn() };
let warn: ReturnType<typeof vi.spyOn>;

function broadcast(targetType: string, seed: Record<string, TableSeed> = tables()) {
  const db = mockSupabase(seed);
  const service = new BroadcastNotificationsService(
    { service: { from: db.from, rpc } } as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
    scheduler as never,
  );
  const sent = service.sendBroadcast(OPEN, 'u-claire', {
    targetType,
    // A page opened from a Tournament sends it: these audiences ignore it, as "all" does.
    tournamentId: 't-longsword',
    severity: 'info',
    title: 'News',
    body: 'Read me.',
  } as never);
  return { db, sent };
}

const saved = (db: ReturnType<typeof mockSupabase>) =>
  writesTo(db, 'event_broadcast_recipients')
    .flatMap((write) => write.row as SupabaseRow[])
    .map((row) => [row['person_id'], row['user_id']]);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: [{ user_id: 'u-paul', email: 'paul@account.example' }],
    error: null,
  });
  scheduler.sendImmediate.mockReset();
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a broadcast to the Workshop attendees (533)', () => {
  it('tells seats and waiting places of running sessions, draft Workshops included', async () => {
    const { db, sent } = broadcast('workshop_attendees');

    await expect(sent).resolves.toEqual({ id: 'b-1', recipientCount: 3 });
    expect(saved(db)).toEqual([
      ['p-alice', 'u-alice'],
      ['p-bob', 'u-bob'],
      ['p-eve', 'u-eve'],
    ]);
    expect(writesTo(db, 'event_broadcast_notifications')[0]?.row).toMatchObject({
      target_type: 'workshop_attendees',
    });
    // The double ignores the projection: only these hold the columns each read uses.
    expect(selectsFor(db.from, 'workshops')).toEqual(['id']);
    expect(selectsFor(db.from, 'workshop_sessions')).toEqual(['id']);
    expect(new Set(selectsFor(db.from, 'workshop_enrollments'))).toEqual(new Set(['id, user_id']));
  });

  it('reads hundreds of attendees in pieces a request line can carry', async () => {
    const crowd = Array.from({ length: 250 }, (_, i) => `x${String(i).padStart(3, '0')}`);
    const base = tables();
    const { db, sent } = broadcast(
      'workshop_attendees',
      tables({
        workshop_enrollments: {
          rows: [
            ...base.workshop_enrollments.rows,
            ...crowd.map((name) => booking(name, 's-sun', 'confirmed')),
          ],
        },
        persons: { rows: [...base.persons.rows, ...crowd.map((name) => person(name))] },
      }),
    );

    await expect(sent).resolves.toMatchObject({ recipientCount: 253 });
    const pieces = filtersFor(db.from, 'persons', 'in').map(([, ids]) => (ids as string[]).length);
    expect(pieces).toEqual([200, 53]);
  });

  it('is refused as having nobody when the Event has no Workshop', async () => {
    const { sent } = broadcast('workshop_attendees', tables({ workshops: { rows: [] } }));

    await expect(sent).rejects.toThrow(BadRequestException);
    await expect(sent).rejects.toThrow('No recipients matched');
  });
});

describe('a broadcast to the instructors (533, 534)', () => {
  it('tells the tagged and the named, each once; by account when off the roster', async () => {
    const { db, sent } = broadcast('instructors');

    await expect(sent).resolves.toEqual({ id: 'b-1', recipientCount: 3 });
    expect(saved(db)).toEqual([
      ['p-marie', 'u-marie'],
      ['p-zoe', 'u-zoe'],
      [null, 'u-paul'],
    ]);
    expect(selectsFor(db.from, 'event_instructors')).toEqual(['person_id']);
    expect(selectsFor(db.from, 'workshop_instructors')).toEqual(['global_person_id']);
  });

  it('says how many name-only instructors it could not tell', async () => {
    const { sent } = broadcast('instructors');
    await sent;

    expect(warn.mock.calls).toContainEqual([
      `Broadcast of ${OPEN}: 1 name-only instructor(s) left out, no profile to tell`,
    ]);
  });

  it('tells a tagged instructor when the Event has no Workshop', async () => {
    const { db, sent } = broadcast('instructors', tables({ workshops: { rows: [] } }));

    await expect(sent).resolves.toEqual({ id: 'b-1', recipientCount: 2 });
    expect(saved(db)).toEqual([
      ['p-marie', 'u-marie'],
      ['p-zoe', 'u-zoe'],
    ]);
  });

  it('fails, rather than reporting nobody, when the tagged instructors cannot be read', async () => {
    const { sent } = broadcast(
      'instructors',
      tables({ event_instructors: { data: null, error: { message: 'boom' } } }),
    );

    await expect(sent).rejects.toThrow('Event instructors unreadable: boom');
    expect(scheduler.sendImmediate).not.toHaveBeenCalled();
  });
});
