/**
 * A person booked into a session after the desk marked them arrived that day is ticked when booked
 * (operator ruling 546), in a Workshop whose switch is on (543). The tick carries the arrival time.
 *
 * Only a NEW booking: a second "Book" tap on an existing one ticks nobody, since the switch may
 * have gone on after the arrival ("turning it on at 10:05 ticks nobody who arrived at 9:00").
 * Best effort, as the booking's alert: the booking stands when the tick fails, and the log says so.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { EnrollmentService } from './enrollment.service';

const SESSION = 's-1';
const EVENT = 'ev-a';
/** Saturday 10:00 in Paris. */
const SATURDAY_SESSION = '2026-11-14T09:00:00Z';
/** Saturday 09:12 in Paris. */
const SATURDAY_ARRIVAL = '2026-11-14T08:12:00Z';
const row = (data: unknown) => ({ data, error: null });

const arrived = (markedAt = SATURDAY_ARRIVAL, state = 'present') =>
  row({ state, marked_at: markedAt, events: { timezone: 'Europe/Paris' } });

function build({ auto = true, existing = null as unknown, arrival = arrived() as TableSeed } = {}) {
  const supabase = mockSupabase({
    workshop_sessions: [
      row({
        status: 'scheduled',
        workshop_id: 'w-1',
        starts_at: SATURDAY_SESSION,
        workshops: { capacity: null, status: 'published', event_id: EVENT, auto_check_in: auto },
      }),
      row([{ id: SESSION }]),
    ],
    persons: { rows: [{ id: 'lea', event_id: EVENT, global_person_id: null }] },
    // No booking yet (or Léa's), the insert's read-back, then the tick.
    workshop_enrollments: [row(existing), row({ id: 'e-1' }), row(null)],
    event_arrivals: arrival,
  });
  const service = new EnrollmentService(
    supabase as never,
    {} as never,
    { scheduleWorkshopSessionStarting: vi.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, supabase };
}

const updates = (supabase: ReturnType<typeof mockSupabase>) =>
  writesTo(supabase, 'workshop_enrollments').filter((write) => write.op === 'update');

describe('a booking made after arriving that day (546)', () => {
  it('is ticked with the arrival time, never over a tap, only a seat or a waiting-list place', async () => {
    const { service, supabase } = build();

    await expect(service.enroll(SESSION, 'lea')).resolves.toEqual({
      id: 'e-1',
      personId: 'lea',
      sessionId: SESSION,
      status: 'confirmed',
      waitlistPosition: null,
    });

    const [tick] = updates(supabase);
    expect(tick?.row).toEqual({ checked_in_at: SATURDAY_ARRIVAL, check_in_source: 'desk' });
    const named = (method: string, column: string) =>
      tick?.filters.find((f) => f.method === method && f.args[0] === column)?.args[1];
    expect(named('eq', 'workshop_session_id')).toBe(SESSION);
    expect(named('eq', 'user_id')).toBe('lea');
    expect(named('is', 'check_in_source')).toBeNull();
    expect(named('in', 'status')).toEqual(['confirmed', 'waitlisted']);
    expect(selectsFor(supabase.from, 'event_arrivals')).toEqual([
      'state, marked_at, events ( timezone )',
    ]);
  });

  it.each<[string, Parameters<typeof build>[0]]>([
    ['the desk marked her on another day', { arrival: arrived('2026-11-13T08:00:00Z') }],
    ['the desk undid her arrival', { arrival: arrived(SATURDAY_ARRIVAL, 'absent') }],
    ['the desk never marked her', { arrival: row(null) }],
  ])('is not ticked when %s', async (_case, setup) => {
    const { service, supabase } = build(setup);

    await service.enroll(SESSION, 'lea');

    expect(updates(supabase)).toEqual([]);
  });

  it("is not ticked, and asks the desk nothing, when the Workshop's switch is off", async () => {
    const { service, supabase } = build({ auto: false });

    await service.enroll(SESSION, 'lea');

    expect(updates(supabase)).toEqual([]);
    expect(queriedTables(supabase.from)).not.toContain('event_arrivals');
  });

  it('ticks nobody on a second "Book" tap: the booking was not made now', async () => {
    const { service, supabase } = build({
      existing: { id: 'e-1', status: 'confirmed', position: null },
    });

    await service.enroll(SESSION, 'lea');

    expect(updates(supabase)).toEqual([]);
    expect(queriedTables(supabase.from)).not.toContain('event_arrivals');
  });

  it('keeps the booking when the arrival cannot be read, and says so in the log', async () => {
    const { service, supabase } = build({ arrival: { data: null, error: { message: 'down' } } });
    const logged = vi.spyOn(
      (service as unknown as { logger: { error: (m: string) => void } }).logger,
      'error',
    );

    await expect(service.enroll(SESSION, 'lea')).resolves.toMatchObject({ id: 'e-1' });
    expect(updates(supabase)).toEqual([]);
    expect(logged).toHaveBeenCalledWith(
      `Session ${SESSION}: the desk tick of lea was not written: The arrival of lea was not read: down`,
    );
  });
});
