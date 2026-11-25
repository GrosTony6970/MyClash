/**
 * A protest is one tap on the pad when a Fighter disputes the referee's call (the protest
 * counter's design). It is its own entry of the Match: kept, listed and voided by the API, and
 * never part of the score. These run the real service, the real over-Event guard and the real
 * club-role check over one seeded database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { filtersFor, scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { matchLocked } from '../matches/match-locked';
import {
  BLUE,
  PAD,
  RED,
  SCOREKEEPER,
  STRANGER,
  SUPER_ADMIN,
  THIRD,
  dto,
  setup,
} from './protests.fixtures';

const FROZEN = new ConflictException({
  message: 'Event results are frozen',
  code: 'event_results_frozen',
});

const saved = (over: Record<string, unknown> = {}) => ({
  id: 'protest-1',
  client_uuid: 'p-uuid-1',
  match_id: 'm1',
  tournament_id: 'tournament-1',
  registration_id: RED,
  sequence: 7,
  round_number: 2,
  voided: false,
  voided_reason: null,
  ...over,
});

describe('ProtestsService.createProtest', () => {
  it('a resend with the same clientUuid returns the saved row and writes nothing', async () => {
    const { db, service } = setup({ protests: { rows: [saved()] } });

    await expect(service.createProtest('m1', dto(), PAD)).resolves.toEqual(saved());
    expect(db.writes).toEqual([]);
  });

  it('a clientUuid saved on another bout is a 400', async () => {
    const { db, service } = setup({ protests: { rows: [saved({ match_id: 'm2' })] } });

    await expect(service.createProtest('m1', dto(), PAD)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.writes).toEqual([]);
  });

  it("the row is stamped with the bout's current_round, the actor's staff_account_id or by_user_id, and clock_time_ms ?? null", async () => {
    const pad = setup();
    await pad.service.createProtest('m1', dto({ clockTimeMs: 61_000 }), PAD);
    expect(writesTo(pad.db, 'match_protests')[0]?.row).toEqual({
      client_uuid: 'p-uuid-1',
      match_id: 'm1',
      tournament_id: 'tournament-1',
      registration_id: RED,
      team_id: null,
      sequence: 7,
      round_number: 2,
      clock_time_ms: 61_000,
      occurred_at: '2026-11-17T10:00:00Z',
      by_user_id: null,
      staff_account_id: 'staff-1',
      voided: false,
    });

    const login = setup();
    const row = await login.service.createProtest('m1', dto({ registrationId: BLUE }), {
      userId: SCOREKEEPER,
    });
    expect(writesTo(login.db, 'match_protests')[0]?.row).toMatchObject({
      registration_id: BLUE,
      by_user_id: SCOREKEEPER,
      staff_account_id: null,
      clock_time_ms: null,
    });
    // The row the database handed back, its id included.
    expect(row).toMatchObject({ id: 'protest-new', registration_id: BLUE });
  });

  it('a protest is taken while the bout awaits its round advance', async () => {
    const { db, service } = setup({ awaitingRoundAdvance: true });

    await service.createProtest('m1', dto(), PAD);
    // Stamped with the round that just ended (the design, call 5).
    expect(writesTo(db, 'match_protests')[0]?.row).toMatchObject({ round_number: 2 });
  });

  it('a protest is taken on a completed bout', async () => {
    const { db, service } = setup({ status: 'completed' });

    await service.createProtest('m1', dto(), PAD);
    expect(writesTo(db, 'match_protests')).toHaveLength(1);
  });

  it('a protest on a scheduled bout is refused 409 bout_not_started', async () => {
    const { db, service } = setup({ status: 'scheduled' });

    const refusal = await service.createProtest('m1', dto(), PAD).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      code: 'bout_not_started',
    });
    expect(db.writes).toEqual([]);
  });

  it('a protest older than the last reset is refused 409 scored_before_reset', async () => {
    const { db, service } = setup({
      matchEvents: [
        { match_id: 'm1', type: 'reset_match', sequence: 4, occurred_at: '2026-11-17T10:05:00Z' },
      ],
    });

    const refusal = await service.createProtest('m1', dto(), PAD).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      code: 'scored_before_reset',
    });
    expect(db.writes).toEqual([]);
  });

  it('a protest on a locked bout is refused', async () => {
    const { db, service } = setup({ lockedAt: '2026-11-17T09:00:00Z' });

    await expect(service.createProtest('m1', dto(), PAD)).rejects.toEqual(matchLocked());
    expect(db.writes).toEqual([]);
  });

  it('on an over Event it is refused event_results_frozen for a scorekeeper and taken for a super admin', async () => {
    const organiser = setup({ eventStatus: 'completed' });
    await expect(
      organiser.service.createProtest('m1', dto(), { userId: SCOREKEEPER }),
    ).rejects.toEqual(FROZEN);
    expect(organiser.db.writes).toEqual([]);

    const admin = setup({ eventStatus: 'archived' });
    await admin.service.createProtest('m1', dto(), {
      userId: SUPER_ADMIN,
      correctsOverEvent: true,
    });
    expect(writesTo(admin.db, 'match_protests')).toHaveLength(1);
  });

  it('a caller who may not score for the club is refused before anything is read of the protest', async () => {
    const { db, service } = setup();

    await expect(service.createProtest('m1', dto(), { userId: STRANGER })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.writes).toEqual([]);
    expect(selectsFor(db.from, 'match_protests')).toEqual([]);
  });

  it('a registration that is neither red nor blue is a 400', async () => {
    const { db, service } = setup();

    await expect(
      service.createProtest('m1', dto({ registrationId: THIRD }), PAD),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.writes).toEqual([]);
  });

  it('a lost race on the same clientUuid answers the row the other send saved', async () => {
    const { service } = setup({
      protests: [
        { data: null, error: null },
        { data: null, error: { message: 'duplicate key value violates unique constraint' } },
        { data: saved(), error: null },
      ],
    });

    await expect(service.createProtest('m1', dto(), PAD)).resolves.toEqual(saved());
  });

  it('reads the bout, its Tournament and its club in one read, and the replay by its pad id', async () => {
    const { db, service } = setup();

    await service.createProtest('m1', dto(), PAD);
    expect(selectsFor(db.from, 'matches')[0]).toBe(
      'id, status, red_registration_id, blue_registration_id, red_team_id, blue_team_id, ' +
        'locked_at, current_round, ' +
        'phases!inner(tournament_id, tournaments!inner(events!inner(organization_id)))',
    );
    expect(filtersFor(db.from, 'matches', 'eq')[0]).toEqual(['id', 'm1']);
    expect(selectsFor(db.from, 'match_protests')[0]).toBe('*');
    expect(filtersFor(db.from, 'match_protests', 'eq')[0]).toEqual(['client_uuid', 'p-uuid-1']);
  });
});

describe('ProtestsService.voidProtest', () => {
  it('unknown id 404', async () => {
    const { db, service } = setup();

    await expect(service.voidProtest('nope', {}, PAD)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.writes).toEqual([]);
  });

  it('already voided 400', async () => {
    const { db, service } = setup({ protests: { rows: [saved({ voided: true })] } });

    await expect(service.voidProtest('protest-1', {}, PAD)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.writes).toEqual([]);
  });

  it('locked bout refused', async () => {
    const { db, service } = setup({
      lockedAt: '2026-11-17T09:00:00Z',
      protests: { rows: [saved()] },
    });

    await expect(service.voidProtest('protest-1', {}, PAD)).rejects.toEqual(matchLocked());
    expect(db.writes).toEqual([]);
  });

  it('over Event super admin only', async () => {
    const organiser = setup({ eventStatus: 'completed', protests: { rows: [saved()] } });
    await expect(
      organiser.service.voidProtest('protest-1', {}, { userId: SCOREKEEPER }),
    ).rejects.toEqual(FROZEN);
    expect(organiser.db.writes).toEqual([]);

    const admin = setup({ eventStatus: 'archived', protests: { rows: [saved()] } });
    await admin.service.voidProtest(
      'protest-1',
      {},
      { userId: SUPER_ADMIN, correctsOverEvent: true },
    );
    expect(writesTo(admin.db, 'match_protests')).toHaveLength(1);
  });

  it('the update is {voided:true, voided_reason}', async () => {
    // A decoy on another bout: a read that lost its id filter finds two rows, not this one.
    const decoy = saved({ id: 'protest-decoy', client_uuid: 'p-uuid-9', match_id: 'm2' });
    const { db, service } = setup({ protests: { rows: [decoy, saved()] } });

    await service.voidProtest('protest-1', { reason: 'tapped by mistake' }, PAD);
    // The double ignores the projection: only these hold that the read takes this protest whole.
    expect(selectsFor(db.from, 'match_protests')[0]).toBe('*');
    expect(filtersFor(db.from, 'match_protests', 'eq')[0]).toEqual(['id', 'protest-1']);
    const [write] = writesTo(db, 'match_protests');
    expect(write?.row).toEqual({ voided: true, voided_reason: 'tapped by mistake' });
    expect(scopedTo(write, 'id')).toBe('protest-1');

    const bare = setup({ protests: { rows: [saved()] } });
    await bare.service.voidProtest('protest-1', {}, PAD);
    expect(writesTo(bare.db, 'match_protests')[0]?.row).toEqual({
      voided: true,
      voided_reason: null,
    });
  });
});

describe('a protest never reaches the score', () => {
  it('recording or voiding a protest writes match_protests only', async () => {
    const created = setup();
    await created.service.createProtest('m1', dto(), PAD);
    expect(created.db.writes.map((write) => write.table)).toEqual(['match_protests']);

    const voided = setup({ protests: { rows: [saved()] } });
    await voided.service.voidProtest('protest-1', {}, PAD);
    expect(voided.db.writes.map((write) => write.table)).toEqual(['match_protests']);
  });

  it('the service takes no scoring service at all', () => {
    const source = readFileSync(join(__dirname, 'protests.service.ts'), 'utf8');
    expect(source).not.toMatch(/ScoringService|recomputeMatchScore|assertCorrectionLands/);
    expect(source).not.toMatch(/nothingOnTheSheet|start-count/);
  });
});

describe('ProtestsService.listMatchProtests', () => {
  it("the list read selects '*' from match_protests filtered on match_id and ordered by sequence", async () => {
    const { db, service } = setup({
      protests: {
        rows: [
          saved({ id: 'p-9', sequence: 9 }),
          saved({ id: 'p-other', match_id: 'm2', sequence: 1 }),
          saved({ id: 'p-3', sequence: 3, voided: true }),
        ],
      },
    });

    const rows = (await service.listMatchProtests('m1')) as Array<{ id: string }>;
    // Voided rows included: the history shows them struck through.
    expect(rows.map((row) => row.id)).toEqual(['p-3', 'p-9']);
    expect(selectsFor(db.from, 'match_protests')).toEqual(['*']);
    expect(filtersFor(db.from, 'match_protests', 'eq')).toEqual([['match_id', 'm1']]);
    expect(filtersFor(db.from, 'match_protests', 'order')).toEqual([
      ['sequence', { ascending: true }],
    ]);
  });
});
