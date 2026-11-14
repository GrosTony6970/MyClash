import { describe, expect, it, vi } from 'vitest';
import { sparStarting } from '../notifications/notice-texts/notice-texts';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import {
  SPAR_REMINDER_LEAD_MINUTES,
  scheduleSparReminders,
  type SparReminderDeps,
} from './spar-reminder';

const REQUEST = '3c1f0a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a02';
const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a03';
const OTHER = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a04';
const ACCOUNT_JULIE = '9a8b7c6d-1111-4222-8333-944455566601';
const ACCOUNT_MARC = '9a8b7c6d-1111-4222-8333-944455566602';
const SPARS = '/me/fightbook?tab=spars';

const SELECT =
  'status, spar_day, spar_time, zone, asker_global_person_id, receiver_global_person_id';

// PostgREST returns a TIME as '15:00:00', never '15:00'.
const spar = (over: Record<string, unknown> = {}) => ({
  id: REQUEST,
  status: 'agreed',
  spar_day: '2026-11-14',
  spar_time: '15:00:00',
  zone: 'Europe/Paris',
  asker_global_person_id: MARC,
  receiver_global_person_id: JULIE,
  ...over,
});

function world(
  row: Record<string, unknown> | null = spar(),
  profiles = [
    { id: JULIE, claimed_by_user_id: ACCOUNT_JULIE },
    { id: MARC, claimed_by_user_id: ACCOUNT_MARC },
    { id: OTHER, claimed_by_user_id: 'someone-else' },
  ],
) {
  const db = mockSupabase({
    spar_requests: { rows: row ? [row] : [] },
    global_persons: { rows: profiles },
  });
  const scheduleReminder = vi.fn(async () => undefined);
  const logger = { warn: vi.fn(), error: vi.fn() };
  const d = {
    db: db.service,
    notifications: { scheduleReminder },
    logger,
  } as unknown as SparReminderDeps;
  return { d, db, scheduleReminder, logger };
}

const at = (iso: string) => new Date(iso);

describe('the reminder of an agreed spar', () => {
  it('reads the spar and the two profiles, with their filters', async () => {
    const { d, db } = world();
    await scheduleSparReminders(d, REQUEST, at('2026-11-14T10:00:00Z'));
    expect(selectsFor(db.from, 'spar_requests')).toEqual([SELECT]);
    expect(filtersFor(db.from, 'spar_requests', 'eq')).toEqual([['id', REQUEST]]);
    expect(selectsFor(db.from, 'global_persons')).toEqual(['id, claimed_by_user_id']);
    expect(filtersFor(db.from, 'global_persons', 'in')).toEqual([['id', [MARC, JULIE]]]);
  });

  it.each([
    ['winter', '2026-11-14', '2026-11-14T10:00:00Z', '2026-11-14T14:00:00.000Z'],
    ['summer', '2026-07-04', '2026-07-04T10:00:00Z', '2026-07-04T13:00:00.000Z'],
  ])(
    'sets one reminder per account, 10 minutes before the Event-zone start (%s)',
    async (_, day, now, startsAt) => {
      const { d, scheduleReminder } = world(spar({ spar_day: day }));
      await scheduleSparReminders(d, REQUEST, at(now));
      expect(scheduleReminder).toHaveBeenCalledTimes(2);
      const sent = (userId: string) => ({
        kind: 'spar_starting',
        entityId: REQUEST,
        userId,
        startsAt,
        leadMinutes: SPAR_REMINDER_LEAD_MINUTES,
        title: sparStarting().title,
        body: sparStarting().body,
        url: SPARS,
        preference: 'fightbook',
      });
      expect(scheduleReminder).toHaveBeenCalledWith(sent(ACCOUNT_MARC));
      expect(scheduleReminder).toHaveBeenCalledWith(sent(ACCOUNT_JULIE));
      for (const [job] of scheduleReminder.mock.calls as unknown as Array<[object]>) {
        expect(job).not.toHaveProperty('email');
      }
    },
  );

  it('holds the lead at 10 minutes, and the copy in both languages, with no name', () => {
    expect(SPAR_REMINDER_LEAD_MINUTES).toBe(10);
    const { title, body } = sparStarting();
    expect(title).toBe('Spar bientôt / Spar soon');
    expect(body).toBe('Votre spar commence dans 10 minutes. / Your spar starts in 10 minutes.');
  });

  it.each([
    ['start minus 11 minutes', '2026-11-14T13:49:00Z', 2],
    ['start minus 10 minutes exactly', '2026-11-14T13:50:00Z', 0],
    ['start minus 4 minutes', '2026-11-14T13:56:00Z', 0],
  ])('at %s the reminders set are as ruling 745 says', async (_, now, calls) => {
    const { d, scheduleReminder } = world();
    await scheduleSparReminders(d, REQUEST, at(now));
    expect(scheduleReminder).toHaveBeenCalledTimes(calls);
  });

  it.each([
    ['no time', spar({ spar_time: null })],
    ['a cancelled spar', spar({ status: 'cancelled' })],
    ['a not-this-time spar', spar({ status: 'not_this_time' })],
    ['a pending ask', spar({ status: 'pending' })],
    ['an unreadable time', spar({ spar_time: 'soon' })],
    ['no such spar', null],
  ])('sets nothing for %s', async (_, row) => {
    const { d, scheduleReminder } = world(row);
    await scheduleSparReminders(d, REQUEST, at('2026-11-14T10:00:00Z'));
    expect(scheduleReminder).not.toHaveBeenCalled();
  });

  it('sets both when the spar was marked done between the Yes and the read', async () => {
    // "We sparred" opens at 00:00 of the spar day; an undo later leaves no other chance to set
    // the reminders. The job is re-checked when it fires (WANTED.spar_starting drops a done spar).
    const { d, scheduleReminder } = world(spar({ status: 'done' }));
    await scheduleSparReminders(d, REQUEST, at('2026-11-14T10:00:00Z'));
    expect(scheduleReminder).toHaveBeenCalledTimes(2);
  });

  it('sets one for the other fighter when a profile is held by no account', async () => {
    const { d, scheduleReminder, logger } = world(spar(), [
      { id: JULIE, claimed_by_user_id: null as unknown as string },
      { id: MARC, claimed_by_user_id: ACCOUNT_MARC },
    ]);
    await scheduleSparReminders(d, REQUEST, at('2026-11-14T10:00:00Z'));
    expect(scheduleReminder).toHaveBeenCalledTimes(1);
    expect(scheduleReminder).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ACCOUNT_MARC }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      `FightBook spar_starting of ${REQUEST}: one profile has no account; the other fighter's reminder is set`,
    );
  });

  describe('each fighter reminder is set on its own', () => {
    const NOW = at('2026-11-14T10:00:00Z');
    const LINE = `FightBook spar_starting reminder of ${REQUEST} was not set: `;

    it('starts the second call while the first is still unresolved', async () => {
      const { d, scheduleReminder } = world();
      let release: () => void = () => undefined;
      scheduleReminder.mockImplementationOnce(
        () => new Promise<undefined>((resolve) => (release = () => resolve(undefined))),
      );
      const done = scheduleSparReminders(d, REQUEST, NOW);
      await vi.waitFor(() => expect(scheduleReminder).toHaveBeenCalledTimes(2));
      release();
      await done;
    });

    it('still sets the second when the first fails, and logs one line with the request id', async () => {
      const { d, scheduleReminder, logger } = world();
      scheduleReminder.mockRejectedValueOnce(new Error('queue is down'));
      await expect(scheduleSparReminders(d, REQUEST, NOW)).resolves.toBeUndefined();
      expect(scheduleReminder).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(`${LINE}Error`);
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.stringContaining(`spar_starting of ${REQUEST} was not set`),
      );
    });

    it('logs one line per failed reminder when both fail, with no user id', async () => {
      const { d, scheduleReminder, logger } = world();
      // The queue's errors can name the job id, and the job id holds the account id.
      scheduleReminder.mockImplementation((async (job: { userId: string }) => {
        throw new TypeError(`job spar_starting:${REQUEST}:${job.userId} could not be added`);
      }) as never);
      await expect(scheduleSparReminders(d, REQUEST, NOW)).resolves.toBeUndefined();
      expect(scheduleReminder).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledTimes(2);
      for (const [line] of logger.error.mock.calls as unknown as Array<[string]>) {
        expect(line).toBe(`${LINE}TypeError`);
        expect(line).not.toContain(ACCOUNT_JULIE);
        expect(line).not.toContain(ACCOUNT_MARC);
      }
    });
  });

  describe('a failed read sets nothing and logs one line with no message in it', () => {
    const NOW = at('2026-11-14T10:00:00Z');
    const LINE = `FightBook spar_starting of ${REQUEST} was not set: `;
    // A database message can echo the values it was given; nothing here may reach the log.
    const answered = (code: string) => ({
      data: null,
      error: { code, message: `invalid input syntax for type uuid: "${ACCOUNT_JULIE}"` },
    });

    const logsOnly = (logger: ReturnType<typeof world>['logger'], line: string) => {
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(line);
      expect(logger.error.mock.calls[0]?.[0]).not.toContain(ACCOUNT_JULIE);
      // A failed profiles read must stop there, not go on to say a profile has no account.
      expect(logger.warn).not.toHaveBeenCalled();
    };

    it('never throws: an unexpected throw logs its kind, never its message', async () => {
      const { d, scheduleReminder, logger } = world();
      d.db = {
        from: () => {
          throw new TypeError(`database is down for ${ACCOUNT_JULIE}`);
        },
      } as never;
      await expect(scheduleSparReminders(d, REQUEST, NOW)).resolves.toBeUndefined();
      expect(scheduleReminder).not.toHaveBeenCalled();
      logsOnly(logger, `${LINE}TypeError`);
    });

    it('the spar read answered with an error logs its code', async () => {
      const { d, scheduleReminder, logger } = world();
      d.db = mockSupabase({ spar_requests: answered('22P02') }).service as never;
      await expect(scheduleSparReminders(d, REQUEST, NOW)).resolves.toBeUndefined();
      expect(scheduleReminder).not.toHaveBeenCalled();
      logsOnly(logger, `${LINE}the spar is unreadable (22P02)`);
    });

    it('the profiles read answered with an error logs its code', async () => {
      const { d, scheduleReminder, logger } = world();
      d.db = mockSupabase({
        spar_requests: { rows: [spar()] },
        global_persons: answered('57014'),
      }).service as never;
      await expect(scheduleSparReminders(d, REQUEST, NOW)).resolves.toBeUndefined();
      expect(scheduleReminder).not.toHaveBeenCalled();
      logsOnly(logger, `${LINE}the profiles are unreadable (57014)`);
    });

    it('a read that never reached the database says it has no code', async () => {
      // supabase-js answers a failed fetch with an empty code and the fetch error as message.
      const { d, logger } = world();
      d.db = mockSupabase({ spar_requests: answered('') }).service as never;
      await scheduleSparReminders(d, REQUEST, NOW);
      logsOnly(logger, `${LINE}the spar is unreadable (no code)`);
    });
  });
});
