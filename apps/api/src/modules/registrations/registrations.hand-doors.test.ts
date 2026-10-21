import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { fighterStatusDouble } from '../matches/fighter-status.fixtures';
import { eventResultsFrozen } from '../matches/event-results-frozen';
import { RegistrationsService } from './registrations.service';

/**
 * The organiser's hand (slice B, migration 0240): check-in, a withdrawal and its undo (ruling
 * 110), and the waitlist promotes. Each door changes the hand through the status settle, never by
 * a write of its own: the hand it read goes with it, so two changes at once cannot both land, and
 * a promote seats its entry and clears its place in one step. A door whose change can move the
 * Fighter in or out refuses an Event that is over (check-in changes no bout). Every retry settles.
 */

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'reg-ana',
  tournament_id: 't1',
  status: 'checked_in',
  entry_status: 'checked_in',
  waitlist_position: null,
  ...over,
});
const waiting = (id: string, position: number) =>
  entry({ id, status: 'waitlist', entry_status: 'waitlist', waitlist_position: position });

function doors(rows: Record<string, unknown>[], maxParticipants: number | null = null) {
  const db = mockSupabase({
    registrations: { rows },
    tournaments: { rows: [{ id: 't1', max_participants: maxParticipants }] },
  });
  const status = fighterStatusDouble(undefined, () => db.writes);
  const guard = { assertTournamentResultsOpen: vi.fn(async () => undefined) };
  const service = new RegistrationsService(db as never, {} as never, status, guard as never);
  const changes = () => status.calls.map((call) => [call.input.registrationId, call.input.entry]);
  return { db, status, guard, service, changes };
}

const entryChanged = () =>
  new ConflictException({ message: 'changed', code: 'entry_status_changed' });

describe('check-in', () => {
  it('changes the hand through the settle, with the hand it read, and stays open when over', async () => {
    const { guard, service, changes } = doors([
      entry({ status: 'registered', entry_status: 'registered' }),
    ]);

    await expect(service.updateStatus('reg-ana', 'checked_in', 'org-1')).resolves.toMatchObject({
      id: 'reg-ana',
    });

    expect(changes()).toEqual([['reg-ana', { status: 'checked_in', expected: 'registered' }]]);
    expect(guard.assertTournamentResultsOpen).not.toHaveBeenCalled();
  });
});

describe('a withdrawal by hand (ruling 110)', () => {
  it('asks whether results are still open, settles, then seats the 1st waitlisted entry', async () => {
    const { db, guard, service, changes, status } = doors([
      entry(),
      waiting('reg-w1', 1),
      waiting('reg-w2', 2),
    ]);

    await service.updateStatus('reg-ana', 'withdrawn', 'org-1');

    expect(guard.assertTournamentResultsOpen).toHaveBeenCalledWith('t1', 'org-1');
    expect(changes()).toEqual([
      ['reg-ana', { status: 'withdrawn', expected: 'checked_in' }],
      ['reg-w1', { status: 'registered', expected: 'waitlist', clearWaitlist: true }],
    ]);
    // The queue behind closes up only once the seat is taken.
    expect(status.calls[1]?.writesBefore).toEqual([]);
    expect(writesTo(db, 'registrations').length).toBeGreaterThan(0);
  });

  it('with nobody waiting, seats nobody', async () => {
    const { db, service, changes } = doors([entry()]);

    await service.updateStatus('reg-ana', 'withdrawn', 'org-1');

    expect(changes()).toEqual([['reg-ana', { status: 'withdrawn', expected: 'checked_in' }]]);
    expect(writesTo(db, 'registrations')).toEqual([]);
  });

  it('on an Event that is over is refused, and nothing is settled or written', async () => {
    const { db, guard, service, status } = doors([entry(), waiting('reg-w1', 1)]);
    guard.assertTournamentResultsOpen.mockRejectedValueOnce(eventResultsFrozen());

    await expect(service.updateStatus('reg-ana', 'withdrawn', 'org-1')).rejects.toMatchObject({
      response: { code: 'event_results_frozen' },
    });
    expect(status.calls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it('leaves the queue alone when another promote seated its 1st entry first', async () => {
    const { db, service, status } = doors([entry(), waiting('reg-w1', 1), waiting('reg-w2', 2)]);
    status.settle
      .mockResolvedValueOnce({
        before: 'checked_in',
        after: 'withdrawn',
        forfeited: 0,
        broughtBack: 0,
      })
      .mockRejectedValueOnce(entryChanged());

    await service.updateStatus('reg-ana', 'withdrawn', 'org-1');

    expect(writesTo(db, 'registrations')).toEqual([]);
  });

  it('a seat that cannot be settled is a server error', async () => {
    const { db, service, status } = doors([entry(), waiting('reg-w1', 1), waiting('reg-w2', 2)]);
    status.settle
      .mockResolvedValueOnce({
        before: 'checked_in',
        after: 'withdrawn',
        forfeited: 0,
        broughtBack: 0,
      })
      .mockRejectedValueOnce(new Error('the database is away'));

    await expect(service.updateStatus('reg-ana', 'withdrawn', 'org-1')).rejects.toThrow(
      'the database is away',
    );
    expect(writesTo(db, 'registrations')).toEqual([]);
  });
});

describe('the undo of a withdrawal by hand (ruling 110)', () => {
  const withdrawn = entry({ status: 'withdrawn', entry_status: 'withdrawn', out_since: 'x' });

  it('puts the hand back to registered, through the settle', async () => {
    const { guard, service, changes } = doors([withdrawn]);

    await service.updateStatus('reg-ana', 'registered', 'org-1');

    expect(guard.assertTournamentResultsOpen).toHaveBeenCalledWith('t1', 'org-1');
    expect(changes()).toEqual([['reg-ana', { status: 'registered', expected: 'withdrawn' }]]);
  });

  it('is refused when the seat was given away since (tournament_full)', async () => {
    const seated = [
      entry({ id: 'reg-b' }),
      entry({ id: 'reg-c', status: 'registered', entry_status: 'registered' }),
    ];
    const { service, status } = doors([withdrawn, ...seated], 2);

    await expect(service.updateStatus('reg-ana', 'registered', 'org-1')).rejects.toMatchObject({
      response: { reason: 'tournament_full' },
    });
    expect(status.calls).toEqual([]);
  });

  it('on an Event that is over is refused, and nothing is settled', async () => {
    const { guard, service, status } = doors([withdrawn]);
    guard.assertTournamentResultsOpen.mockRejectedValueOnce(eventResultsFrozen());

    await expect(service.updateStatus('reg-ana', 'registered', 'org-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(status.calls).toEqual([]);
  });
});

describe('what the hand cannot be changed to', () => {
  it('an entry that is not there is a 404, and nothing is settled', async () => {
    const { service, status } = doors([]);

    await expect(service.updateStatus('reg-none', 'checked_in', 'org-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(status.calls).toEqual([]);
  });

  it('the same hand again: a retry, so it settles, then is refused', async () => {
    const { service, changes } = doors([
      entry({ status: 'withdrawn', entry_status: 'withdrawn', out_since: 'x' }),
    ]);

    await expect(service.updateStatus('reg-ana', 'withdrawn', 'org-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(changes()).toEqual([['reg-ana', undefined]]);
  });

  it.each([
    ['done: no such status (0078)', 'checked_in', 'done'],
    ['a waitlisted entry seated by hand: the promote’s', 'waitlist', 'registered'],
    ['checked in, back to registered', 'checked_in', 'registered'],
  ])('%s', async (_what, hand, wanted) => {
    const { service, status } = doors([entry({ status: hand, entry_status: hand })]);

    await expect(service.updateStatus('reg-ana', wanted, 'org-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(status.calls).toEqual([]);
  });

  it('a Fighter a card put out may still be withdrawn by hand: the hand is what it reads', async () => {
    const { service, changes } = doors([entry({ status: 'disqualified', out_since: 'x' })]);

    await service.updateStatus('reg-ana', 'withdrawn', 'org-1');

    expect(changes()[0]).toEqual(['reg-ana', { status: 'withdrawn', expected: 'checked_in' }]);
  });
});

describe('the promote of a waitlisted entry', () => {
  it('seats it and clears its place in one settle, then closes the queue behind it', async () => {
    const { db, guard, service, changes, status } = doors([
      waiting('reg-w1', 1),
      waiting('reg-w2', 2),
    ]);

    await service.promoteFromWaitlist('reg-w1', false, 'org-1');

    expect(guard.assertTournamentResultsOpen).toHaveBeenCalledWith('t1', 'org-1');
    expect(changes()).toEqual([
      ['reg-w1', { status: 'registered', expected: 'waitlist', clearWaitlist: true }],
    ]);
    expect(status.calls[0]?.writesBefore).toEqual([]);
    expect(writesTo(db, 'registrations').length).toBeGreaterThan(0);
  });

  it('two promotes of one entry: the second is refused and closes no queue', async () => {
    const { db, service, status } = doors([waiting('reg-w1', 1), waiting('reg-w2', 2)]);
    status.settle.mockRejectedValueOnce(entryChanged());

    await expect(service.promoteFromWaitlist('reg-w1', false, 'org-1')).rejects.toMatchObject({
      response: { code: 'entry_status_changed' },
    });
    expect(db.writes).toEqual([]);
  });

  it('a promote sent again, the entry seated by the first: it settles, then is refused', async () => {
    const { service, changes } = doors([
      entry({ id: 'reg-w1', status: 'registered', entry_status: 'registered' }),
    ]);

    await expect(service.promoteFromWaitlist('reg-w1', false, 'org-1')).rejects.toThrow(
      'Registration is not on the waitlist',
    );
    expect(changes()).toEqual([['reg-w1', undefined]]);
  });

  it('on an Event that is over is refused, and nothing is settled', async () => {
    const { guard, service, status } = doors([waiting('reg-w1', 1)]);
    guard.assertTournamentResultsOpen.mockRejectedValueOnce(eventResultsFrozen());

    await expect(service.promoteFromWaitlist('reg-w1', false, 'org-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(status.calls).toEqual([]);
  });

  it('a full Tournament refuses it unless forced', async () => {
    const full = [entry({ id: 'reg-b' })];
    const refused = doors([waiting('reg-w1', 1), ...full], 1);
    await expect(
      refused.service.promoteFromWaitlist('reg-w1', false, 'org-1'),
    ).rejects.toMatchObject({
      response: { reason: 'tournament_full' },
    });
    expect(refused.status.calls).toEqual([]);

    const forced = doors([waiting('reg-w1', 1), ...full], 1);
    await forced.service.promoteFromWaitlist('reg-w1', true, 'org-1');
    expect(forced.status.calls).toHaveLength(1);
  });
});

describe('a new entry names its hand', () => {
  it('registered on a create, waitlist on a waitlist add', async () => {
    const db = mockSupabase({
      persons: { rows: [{ id: 'person-1', global_person_id: 'gp-1' }] },
      tournaments: { rows: [{ id: 't1', max_participants: null, max_waitlist: null }] },
      registrations: { rows: [], returning: { id: 'reg-new' } },
    });
    const service = new RegistrationsService(
      db as never,
      {} as never,
      fighterStatusDouble(),
      {} as never,
    );

    await service.create('t1', { personId: 'person-1' } as never);
    await service.addToWaitlist('t1', { personId: 'person-1' } as never);

    const inserts = writesTo(db, 'registrations').filter((write) => write.op === 'insert');
    expect(inserts.map((write) => write.row)).toMatchObject([
      { status: 'registered', entry_status: 'registered' },
      { status: 'waitlist', entry_status: 'waitlist' },
    ]);
  });
});
