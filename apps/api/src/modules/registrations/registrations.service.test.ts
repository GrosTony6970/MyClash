import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    service = new RegistrationsService(mockSupabase as never, mockResolver as never);
  });

  // ── Status transitions ────────────────────────────────────────────────────

  describe('updateStatus — status transition enforcement', () => {
    it('allows registered → checked_in', async () => {
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({
        data: { id: 'reg-1', status: 'registered' },
        error: null,
      });

      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({
        data: { id: 'reg-1', status: 'checked_in' },
        error: null,
      });

      fromMock.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);

      const result = await service.updateStatus('reg-1', 'checked_in');
      expect((result as { status: string }).status).toBe('checked_in');
    });

    it('blocks registered → done (cannot skip checked_in)', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({
        data: { id: 'reg-1', status: 'registered' },
        error: null,
      });
      fromMock.mockReturnValue(chain);

      await expect(service.updateStatus('reg-1', 'done')).rejects.toThrow(BadRequestException);
    });

    it('blocks checked_in → registered (no going back)', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({
        data: { id: 'reg-1', status: 'checked_in' },
        error: null,
      });
      fromMock.mockReturnValue(chain);

      await expect(service.updateStatus('reg-1', 'registered')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows checked_in → done', async () => {
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({
        data: { id: 'reg-1', status: 'checked_in' },
        error: null,
      });

      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({ data: { id: 'reg-1', status: 'done' }, error: null });

      fromMock.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);

      const result = await service.updateStatus('reg-1', 'done');
      expect((result as { status: string }).status).toBe('done');
    });

    it('blocks done → any (terminal state)', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { id: 'reg-1', status: 'done' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.updateStatus('reg-1', 'checked_in')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for nonexistent registration', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.updateStatus('nonexistent', 'checked_in')).rejects.toThrow(
        NotFoundException,
      );
    });
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
      expect((result as { bib_number: number }).bib_number).toBe(6);
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
      expect((result as { bib_number: number }).bib_number).toBe(42);
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
      expect((result as { status: string }).status).toBe('registered');
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
      expect((result as { waitlist_position: number }).waitlist_position).toBe(1);
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

  // ── Slice 3: auto-promote on withdraw + manual promote + reorder ─────────

  describe('updateStatus — auto-promote on withdraw', () => {
    it('promotes the position-1 waitlist entry to registered when someone withdraws', async () => {
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({
        data: { id: 'reg-1', tournament_id: 't1', status: 'registered' },
        error: null,
      });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({
        data: { id: 'reg-1', status: 'withdrawn' },
        error: null,
      });
      // Auto-promote path: read waitlist
      const listWaitlistChain = makeAwaitableChain({
        data: [{ id: 'reg-w1', waitlist_position: 1 }],
        error: null,
      });
      // Promote position 1 → registered
      const promoteUpdateChain = makeChain({ data: null, error: null });
      promoteUpdateChain.eq.mockReturnValue(Promise.resolve({ data: null, error: null }) as never);

      fromMock
        .mockReturnValueOnce(fetchChain) // fetch reg
        .mockReturnValueOnce(updateChain) // update reg → withdrawn
        .mockReturnValueOnce(listWaitlistChain) // list waitlist for this tournament
        .mockReturnValueOnce(promoteUpdateChain); // update first row

      await service.updateStatus('reg-1', 'withdrawn');
      expect(promoteUpdateChain.update).toHaveBeenCalledWith({
        status: 'registered',
        waitlist_position: null,
      });
      expect(promoteUpdateChain.eq).toHaveBeenCalledWith('id', 'reg-w1');
    });

    it('is a no-op on the waitlist side when there is no queue', async () => {
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({
        data: { id: 'reg-1', tournament_id: 't1', status: 'checked_in' },
        error: null,
      });
      const updateChain = makeChain({ data: null, error: null });
      updateChain.single.mockResolvedValue({
        data: { id: 'reg-1', status: 'withdrawn' },
        error: null,
      });
      const listWaitlistChain = makeAwaitableChain({ data: [], error: null });

      fromMock
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(listWaitlistChain);

      const result = await service.updateStatus('reg-1', 'withdrawn');
      expect((result as { status: string }).status).toBe('withdrawn');
    });
  });

  describe('promoteFromWaitlist — manual promote', () => {
    it('flips status to registered and clears waitlist_position', async () => {
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({
        data: { id: 'reg-w2', tournament_id: 't1', status: 'waitlist', waitlist_position: 2 },
        error: null,
      });
      // Force=true skips the capacity check, so no tournament/count chains.
      const updateChain = makeChain({ data: null, error: null });
      updateChain.eq.mockReturnValue(Promise.resolve({ data: null, error: null }) as never);
      // Compact tail: only position 3 is behind position 2.
      const tailChain = makeAwaitableChain({
        data: [
          { id: 'reg-w2', waitlist_position: 2 },
          { id: 'reg-w3', waitlist_position: 3 },
        ],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(updateChain) // flip status
        .mockReturnValueOnce(tailChain); // tail read

      await service.promoteFromWaitlist('reg-w2', true);
      expect(updateChain.update).toHaveBeenCalledWith({
        status: 'registered',
        waitlist_position: null,
      });
    });

    it('refuses when tournament is full and force is not set', async () => {
      const fetchChain = makeChain({ data: null, error: null });
      fetchChain.maybeSingle.mockResolvedValue({
        data: { id: 'reg-w1', tournament_id: 't1', status: 'waitlist', waitlist_position: 1 },
        error: null,
      });
      // assertCapacityForCreate: tournament max=2, count=2 → 409.
      const tournamentChain = makeChain({ data: null, error: null });
      tournamentChain.maybeSingle.mockResolvedValue({
        data: { max_participants: 2 },
        error: null,
      });
      const countChain = makeAwaitableChain({
        data: [{ id: 'r1' }, { id: 'r2' }],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(fetchChain)
        .mockReturnValueOnce(tournamentChain)
        .mockReturnValueOnce(countChain);

      await expect(service.promoteFromWaitlist('reg-w1', false)).rejects.toMatchObject({
        response: { reason: 'tournament_full' },
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
            seed: 3,
            bib_number: 7,
            tournaments: { id: 'tourn-1', name: 'Longsword Open', event_id: 'event-1' },
          },
          {
            id: 'reg-2',
            person_id: 'person-2',
            tournament_id: 'tourn-2',
            status: 'checked_in',
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
          seed: 3,
        },
        {
          id: 'reg-2',
          personId: 'person-2',
          tournamentId: 'tourn-2',
          tournamentName: 'Rapier Open',
          status: 'checked_in',
          seed: null,
        },
      ]);
      // The PostgREST .eq() is the gate that limits rows to this event.
      expect(chain.eq).toHaveBeenCalledWith('tournaments.event_id', 'event-1');
    });

    it('returns an empty array when no rows match (no error, no exception)', async () => {
      const chain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(chain);

      await expect(service.listForEvent('event-empty')).resolves.toEqual([]);
    });
  });

  // ── Transition table completeness ─────────────────────────────────────────

  describe('REGISTRATION_STATUS_TRANSITIONS', () => {
    it('covers all defined statuses', () => {
      const statuses = ['registered', 'checked_in', 'done', 'withdrawn', 'disqualified'];
      for (const s of statuses) {
        expect(REGISTRATION_STATUS_TRANSITIONS).toHaveProperty(s);
      }
    });

    it('registered can go to checked_in or withdrawn (Slice 3 extension)', () => {
      expect(REGISTRATION_STATUS_TRANSITIONS['registered']).toEqual(['checked_in', 'withdrawn']);
    });

    it('waitlist can be promoted to registered (Slice 3 extension)', () => {
      expect(REGISTRATION_STATUS_TRANSITIONS['waitlist']).toEqual(['registered']);
    });

    it('done is a terminal state (no transitions)', () => {
      expect(REGISTRATION_STATUS_TRANSITIONS['done']).toEqual([]);
    });
  });

  // ── CSV import: seed / status / waitlist_position coverage ──────────────────

  describe('importCsv — seed / status / waitlist columns', () => {
    // Self-contained mock (mockImplementation, not the ordered once-queue) so
    // the person lookup + registration insert per row resolve deterministically.
    function setupImportMock() {
      const inserted: Record<string, unknown>[] = [];
      fromMock.mockImplementation((table: string) => {
        if (table === 'persons') {
          const chain: Record<string, unknown> = {};
          chain['select'] = () => chain;
          chain['eq'] = () => chain;
          chain['maybeSingle'] = () => Promise.resolve({ data: { id: 'person-1' }, error: null });
          return chain;
        }
        // registrations
        const chain: Record<string, unknown> = {};
        chain['insert'] = (payload: Record<string, unknown>) => {
          inserted.push(payload);
          return Promise.resolve({ error: null });
        };
        chain['select'] = () => chain;
        chain['eq'] = () => chain;
        chain['order'] = () => chain;
        chain['limit'] = () => chain;
        chain['maybeSingle'] = () => Promise.resolve({ data: null, error: null });
        return chain;
      });
      return { inserted };
    }

    it('imports seed + status + waitlist_position', async () => {
      const { inserted } = setupImportMock();
      const csv = 'email,bib_number,seed,status,waitlist_position\na@b.c,10,3,waitlist,2';
      const report = await service.importCsv('t-1', Buffer.from(csv));
      expect(report.created).toBe(1);
      expect(inserted[0]).toMatchObject({
        bib_number: 10,
        seed: 3,
        status: 'waitlist',
        waitlist_position: 2,
      });
    });

    it('forces waitlist_position to null for non-waitlist statuses', async () => {
      const { inserted } = setupImportMock();
      const csv = 'email,bib_number,status,waitlist_position\na@b.c,10,registered,5';
      const report = await service.importCsv('t-1', Buffer.from(csv));
      expect(report.created).toBe(1);
      expect(inserted[0]).toMatchObject({ status: 'registered', waitlist_position: null });
    });

    it('rejects an invalid status', async () => {
      setupImportMock();
      const csv = 'email,bib_number,status\na@b.c,10,vip';
      const report = await service.importCsv('t-1', Buffer.from(csv));
      expect(report.created).toBe(0);
      expect(report.errors[0]).toContain('invalid status');
    });

    it('requires waitlist_position when status is waitlist', async () => {
      setupImportMock();
      const csv = 'email,bib_number,status\na@b.c,10,waitlist';
      const report = await service.importCsv('t-1', Buffer.from(csv));
      expect(report.created).toBe(0);
      expect(report.errors[0]).toContain('requires waitlist_position');
    });

    it('rejects a non-numeric seed', async () => {
      setupImportMock();
      const csv = 'email,bib_number,seed\na@b.c,10,abc';
      const report = await service.importCsv('t-1', Buffer.from(csv));
      expect(report.created).toBe(0);
      expect(report.errors[0]).toContain('invalid seed');
    });
  });
});
