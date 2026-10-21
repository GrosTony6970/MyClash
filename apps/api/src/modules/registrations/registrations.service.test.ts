import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fighterStatusDouble } from '../matches/fighter-status.fixtures';
import { RegistrationsService } from './registrations.service';
import { REGISTRATION_STATUS_TRANSITIONS } from './dto/registrations.dto';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

// These tests all register a person that already has a global_person_id, so the
// resolver short-circuits and is never invoked; a stub is enough.
const mockResolver = { resolveOrCreateGlobalPerson: vi.fn() };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    in: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    limit: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    nullsFirst: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.nullsFirst.mockReturnValue(chain);
  return chain;
}

/**
 * Creates a chain that is also awaitable (resolves to `result`).
 * Used for `const { data, error } = await q` patterns.
 */
function makeAwaitableChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    nullsFirst: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  });
  for (const key of [
    'select',
    'eq',
    'in',
    'order',
    'limit',
    'insert',
    'update',
    'delete',
    'nullsFirst',
  ]) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('RegistrationsService', () => {
  let service: RegistrationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new RegistrationsService(
      mockSupabase as never,
      mockResolver as never,
      fighterStatusDouble(),
      { assertTournamentResultsOpen: vi.fn() } as never,
    );
  });

  // ── Bib auto-assign ───────────────────────────────────────────────────────

  describe('create — bib auto-assign', () => {
    function noCapTournamentChain() {
      // Slice 2 added a capacity guard that fetches max_participants; tests
      // not exercising the cap mock a null value so the guard short-circuits.
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { max_participants: null }, error: null });
      return chain;
    }

    it('auto-assigns bib_number = max + 1 when not provided', async () => {
      const personChain = makeChain({ data: null, error: null });
      personChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'person-1',
          given_name: 'Jean',
          family_name: 'Dupont',
          club_id: null,
          global_person_id: 'fighter-1',
        },
        error: null,
      });
      // nextBibNumber query returns max=5 (awaitable chain)
      const bibChain = makeAwaitableChain({ data: [{ bib_number: 5 }], error: null });

      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'reg-new', bib_number: 6, status: 'registered' },
        error: null,
      });

      fromMock
        .mockReturnValueOnce(personChain)
        .mockReturnValueOnce(noCapTournamentChain()) // Slice 2: capacity guard tournament fetch
        .mockReturnValueOnce(bibChain) // nextBibNumber
        .mockReturnValueOnce(insertChain); // insert

      const result = await service.create('tournament-1', { personId: 'person-1' });
      expect(result['bib_number']).toBe(6);
    });

    it('uses provided bib_number when given', async () => {
      const personChain = makeChain({ data: null, error: null });
      personChain.maybeSingle.mockResolvedValue({
        data: {
          id: 'person-1',
          given_name: 'Jean',
          family_name: 'Dupont',
          club_id: null,
          global_person_id: 'fighter-1',
        },
        error: null,
      });
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'reg-new', bib_number: 42, status: 'registered' },
        error: null,
      });
      fromMock
        .mockReturnValueOnce(personChain)
        .mockReturnValueOnce(noCapTournamentChain()) // Slice 2: capacity guard tournament fetch
        .mockReturnValueOnce(insertChain);

      const result = await service.create('tournament-1', { personId: 'person-1', bibNumber: 42 });
      expect(result['bib_number']).toBe(42);
    });
  });

  // ── Slice 2: capacity guard + waitlist add ───────────────────────────────

  describe('create — tournament capacity guard', () => {
    function personChainFor(personId: string) {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({
        data: {
          id: personId,
          given_name: 'Jean',
          family_name: 'Dupont',
          club_id: null,
          global_person_id: 'fighter-1',
        },
        error: null,
      });
      return chain;
    }

    it('throws ConflictException with tournament_full when registered count meets max_participants', async () => {
      const personChain = personChainFor('person-1');
      // tournament fetch returns max_participants=3
      const tournamentChain = makeChain({ data: null, error: null });
      tournamentChain.maybeSingle.mockResolvedValue({
        data: { max_participants: 3 },
        error: null,
      });
      // registrations count = 3 (full)
      const countChain = makeAwaitableChain({
        data: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(personChain) // resolveFighter
        .mockReturnValueOnce(tournamentChain) // tournament fetch
        .mockReturnValueOnce(countChain); // registered count

      await expect(service.create('tournament-1', { personId: 'person-1' })).rejects.toMatchObject({
        response: {
          reason: 'tournament_full',
          registeredCount: 3,
          maxParticipants: 3,
        },
      });
    });

    it('succeeds when max_participants is null (no cap)', async () => {
      const personChain = personChainFor('person-1');
      const tournamentChain = makeChain({ data: null, error: null });
      tournamentChain.maybeSingle.mockResolvedValue({
        data: { max_participants: null },
        error: null,
      });
      const bibChain = makeAwaitableChain({ data: [{ bib_number: 0 }], error: null });
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'reg-new', bib_number: 1, status: 'registered' },
        error: null,
      });

      fromMock
        .mockReturnValueOnce(personChain)
        .mockReturnValueOnce(tournamentChain)
        .mockReturnValueOnce(bibChain)
        .mockReturnValueOnce(insertChain);

      const result = await service.create('tournament-1', { personId: 'person-1' });
      expect(result['status']).toBe('registered');
    });
  });

  describe('addToWaitlist', () => {
    function personChainFor(personId: string) {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({
        data: {
          id: personId,
          given_name: 'Jean',
          family_name: 'Dupont',
          club_id: null,
          global_person_id: 'fighter-1',
        },
        error: null,
      });
      return chain;
    }

    it('inserts at position 1 when the waitlist is empty', async () => {
      const personChain = personChainFor('person-1');
      const tournamentChain = makeChain({ data: null, error: null });
      tournamentChain.maybeSingle.mockResolvedValue({
        data: { max_waitlist: null },
        error: null,
      });
      // max position query returns no rows
      const maxPositionChain = makeChain({ data: null, error: null });
      maxPositionChain.maybeSingle.mockResolvedValue({ data: null, error: null });
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'reg-w1', status: 'waitlist', waitlist_position: 1 },
        error: null,
      });

      fromMock
        .mockReturnValueOnce(personChain)
        .mockReturnValueOnce(tournamentChain)
        .mockReturnValueOnce(maxPositionChain)
        .mockReturnValueOnce(insertChain);

      const result = await service.addToWaitlist('tournament-1', { personId: 'person-1' });
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'waitlist', waitlist_position: 1 }),
      );
      expect(result['waitlist_position']).toBe(1);
    });

    it('inserts at position N+1 when the highest existing position is N', async () => {
      const personChain = personChainFor('person-9');
      const tournamentChain = makeChain({ data: null, error: null });
      tournamentChain.maybeSingle.mockResolvedValue({
        data: { max_waitlist: null },
        error: null,
      });
      const maxPositionChain = makeChain({ data: null, error: null });
      maxPositionChain.maybeSingle.mockResolvedValue({
        data: { waitlist_position: 4 },
        error: null,
      });
      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'reg-w5', status: 'waitlist', waitlist_position: 5 },
        error: null,
      });

      fromMock
        .mockReturnValueOnce(personChain)
        .mockReturnValueOnce(tournamentChain)
        .mockReturnValueOnce(maxPositionChain)
        .mockReturnValueOnce(insertChain);

      await service.addToWaitlist('tournament-1', { personId: 'person-9' });
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ waitlist_position: 5 }),
      );
    });

    it('throws waitlist_full when the next position would exceed max_waitlist', async () => {
      const personChain = personChainFor('person-9');
      const tournamentChain = makeChain({ data: null, error: null });
      tournamentChain.maybeSingle.mockResolvedValue({
        data: { max_waitlist: 3 },
        error: null,
      });
      const maxPositionChain = makeChain({ data: null, error: null });
      maxPositionChain.maybeSingle.mockResolvedValue({
        data: { waitlist_position: 3 },
        error: null,
      });

      fromMock
        .mockReturnValueOnce(personChain)
        .mockReturnValueOnce(tournamentChain)
        .mockReturnValueOnce(maxPositionChain);

      await expect(
        service.addToWaitlist('tournament-1', { personId: 'person-9' }),
      ).rejects.toMatchObject({
        response: {
          reason: 'waitlist_full',
          currentCount: 3,
          maxWaitlist: 3,
        },
      });
    });
  });

  describe('reorderWaitlist', () => {
    it('refuses ids that belong to a different tournament', async () => {
      // Validation: list this tournament's waitlist
      const listChain = makeAwaitableChain({
        data: [{ id: 'reg-w1' }, { id: 'reg-w2' }],
        error: null,
      });
      fromMock.mockReturnValueOnce(listChain);

      await expect(service.reorderWaitlist('t1', ['reg-w1', 'reg-w-other'])).rejects.toThrow(
        /not a waitlist entry/,
      );
    });
  });

  // ── listForEvent ─────────────────────────────────────────────────────────

  describe('listForEvent — flat per-event roster used by /persons sub-page', () => {
    it('filters by tournaments.event_id (via !inner join) and maps rows to camelCase', async () => {
      // Supabase chain: from('registrations').select(...).eq(...).order(...) → awaitable
      const chain = makeAwaitableChain({
        data: [
          {
            id: 'reg-1',
            person_id: 'person-1',
            tournament_id: 'tourn-1',
            status: 'registered',
            entry_status: 'registered',
            seed: 3,
            bib_number: 7,
            tournaments: { id: 'tourn-1', name: 'Longsword Open', event_id: 'event-1' },
          },
          {
            id: 'reg-2',
            person_id: 'person-2',
            tournament_id: 'tourn-2',
            status: 'disqualified',
            entry_status: 'checked_in',
            seed: null,
            bib_number: 8,
            tournaments: { id: 'tourn-2', name: 'Rapier Open', event_id: 'event-1' },
          },
        ],
        error: null,
      });
      fromMock.mockReturnValueOnce(chain);

      const result = await service.listForEvent('event-1');

      expect(result).toEqual([
        {
          id: 'reg-1',
          personId: 'person-1',
          tournamentId: 'tourn-1',
          tournamentName: 'Longsword Open',
          status: 'registered',
          entryStatus: 'registered',
          seed: 3,
        },
        {
          id: 'reg-2',
          personId: 'person-2',
          tournamentId: 'tourn-2',
          tournamentName: 'Rapier Open',
          status: 'disqualified',
          entryStatus: 'checked_in',
          seed: null,
        },
      ]);
      // The PostgREST .eq() is the gate that limits rows to this event.
      expect(chain.eq).toHaveBeenCalledWith('tournaments.event_id', 'event-1');
      // The double answers whatever the select names: the hand the page offers Withdraw on
      // (ruling 111) must be asked for.
      expect(String(chain.select.mock.calls[0]?.[0])).toContain('entry_status');
    });

    it('returns an empty array when no rows match (no error, no exception)', async () => {
      const chain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(chain);

      await expect(service.listForEvent('event-empty')).resolves.toEqual([]);
    });
  });

  // ── Transition table completeness ─────────────────────────────────────────
  // The doors that use it: `registrations.hand-doors.test.ts`.

  describe('REGISTRATION_STATUS_TRANSITIONS', () => {
    it('is keyed on the organiser’s hand, every value of it', () => {
      expect(Object.keys(REGISTRATION_STATUS_TRANSITIONS).sort()).toEqual([
        'checked_in',
        'registered',
        'waitlist',
        'withdrawn',
      ]);
    });

    it('registered can go to checked_in or withdrawn (Slice 3 extension)', () => {
      expect(REGISTRATION_STATUS_TRANSITIONS['registered']).toEqual(['checked_in', 'withdrawn']);
    });

    it('a withdrawal by hand can be undone (ruling 110)', () => {
      expect(REGISTRATION_STATUS_TRANSITIONS['withdrawn']).toEqual(['registered']);
    });

    it('names no "done": it is no status (0078)', () => {
      expect(Object.values(REGISTRATION_STATUS_TRANSITIONS).flat()).not.toContain('done');
    });

    it('a waitlisted entry is seated by the promote only', () => {
      expect(REGISTRATION_STATUS_TRANSITIONS['waitlist']).toEqual([]);
    });
  });
});
