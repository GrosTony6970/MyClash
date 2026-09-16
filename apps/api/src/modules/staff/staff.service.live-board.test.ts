import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { scopedTo, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import {
  ORG,
  EVENT,
  OTHER_EVENT,
  LICE,
  ACCOUNT,
  req,
  TOURNAMENT,
  POOL_PHASE,
  SWISS_PHASE,
  SHEET,
  sheetRow,
  MATCH_ROWS,
  matchRow,
  boardTables,
  build,
} from './staff.service.live-board.harness';

/**
 * The Live board — the control-room screen an Event organizer watches.
 *
 * One row per Lice, carrying the bout on it, the Scorekeeper assigned to it and
 * that tablet's sync health. It reads seven queries across five tables in one
 * pass, which is why this file used to carry a local double that applied its own
 * filters: a mock returning every row of a table to every query reports a
 * running bout as the Lice's `lastCompleted`.
 *
 * It is now on the shared seeded double, so the filters are the real ones. Each
 * table in `staff.service.live-board.harness.ts` carries at least one decoy —
 * another Event's Lice, another Lice's bout, a voided bout — so a filter that
 * stops narrowing changes an answer here rather than going quiet.
 *
 * `countBoutProgress` reaches its Event through `phases!inner(tournaments!inner(
 * event_id))`, because `matches` has no event_id column. An embedded filter is
 * spelled with a dotted key, so the rows carry
 * `'phases.tournaments.event_id'` flat alongside whatever else they need.
 */

describe('StaffService.getLiveBoard', () => {
  it('throws 403 when the caller lacks an org role on the event', async () => {
    const { svc } = build(boardTables(), 'refuse');

    await expect(svc.getLiveBoard(req, EVENT)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('shows the pistes of this event only', async () => {
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.lice.id).toBe(LICE);
  });

  it('puts the running bout in currentMatch and the finished one in history', async () => {
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.rows[0]!.currentMatch?.id).toBe('m1');
    expect(out.rows[0]!.currentMatch?.redScore).toBe(1);
    expect(out.rows[0]!.queue).toEqual([]);
    expect(out.rows[0]!.lastCompleted?.matchId).toBe('m0');
  });

  it('never shows a bout from a neighbouring event on this board', async () => {
    // `m-elsewhere` is running, on another event's piste. It reaches the board
    // only if the piste read or the bout read stops narrowing.
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    const shown = out.rows.flatMap((r) => [r.currentMatch?.id, ...r.queue.map((q) => q.matchId)]);
    expect(shown).not.toContain('m-elsewhere');
  });

  it('counts the bouts of this event, and leaves voided ones out of the total', async () => {
    // Four bouts are seeded: one running, one completed, one voided, one at
    // another event. So this event has 2 that count and 1 of them done.
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.progress).toEqual({ completed: 1, total: 2 });
  });

  it('shows the scorer assigned to the piste, not one from another event', async () => {
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.rows[0]!.scorer?.name).toBe('Marie');
  });

  it('offers only this event’s accounts in the reassign picker', async () => {
    // The board ships the account list because a Scorekeeper reassigning a piste
    // cannot call the editor-only endpoint. Nothing downstream re-checks the
    // event, so an unscoped read would offer another event's staff by name.
    const { svc } = build(boardTables());

    const out = await svc.getLiveBoard(req, EVENT);

    expect(out.accounts.map((a) => a.accountId)).toEqual([ACCOUNT]);
  });

  it('resolves the event it was asked for before checking the role', async () => {
    // The decoy event is seeded first and belongs to another organisation. Read
    // the wrong row and the board asks for a role on the wrong organisation —
    // which an organiser of THAT event would pass.
    const { svc, assertOrgRole } = build(boardTables());

    await svc.getLiveBoard(req, EVENT);

    expect(assertOrgRole).toHaveBeenCalledWith(ORG, 'U1', 'scorekeeper');
  });

  it('fails the board when the sheet cannot be read, rather than timing bouts on a guess', async () => {
    // The same policy as the board's other reads (bouts, history, accounts): the
    // browser keeps the last board it had and shows the refresh error.
    const { svc } = build(
      boardTables({
        event_programme_configs: { data: null, error: { message: 'statement timeout' } },
      }),
    );

    await expect(svc.getLiveBoard(req, EVENT)).rejects.toThrow('statement timeout');
  });

  describe('each bout at its own planned length (ADR-018)', () => {
    // The running bout on the piste is m1. It used to be timed by the kind of
    // the programme BAR running now, one number for every piste.
    // A second bout is queued on the same piste, in another phase and with its
    // own override, so a length looked up for the wrong bout cannot pass.
    const queued = matchRow('m-next', {
      phase_id: SWISS_PHASE,
      planned_duration_override_minutes: 99,
      scheduled_at: '2026-07-21T10:30:00Z',
    });
    const tablesWith = (running: Record<string, unknown>, sheet: Record<string, unknown> = {}) =>
      boardTables({
        matches: {
          rows: [
            ...MATCH_ROWS.map((row) => (row.id === 'm1' ? { ...row, ...running } : row)),
            queued,
          ],
        },
        event_programme_configs: {
          rows: [
            // Another Event's sheet, seeded first: the sheet read must narrow.
            sheetRow(OTHER_EVENT, { poolMatchDurationMinutes: 4, swissMatchDurationMinutes: 4 }),
            sheetRow(EVENT, { ...SHEET, ...sheet }),
          ],
        },
      });

    it.each<[string, number]>([
      [POOL_PHASE, 6],
      [SWISS_PHASE, 7],
    ])('gives a bout of phase %s the sheet length for its kind', async (phaseId, minutes) => {
      const { svc } = build(tablesWith({ phase_id: phaseId }));

      const out = await svc.getLiveBoard(req, EVENT);

      expect(out.rows[0]!.currentMatch?.id).toBe('m1');
      expect(out.rows[0]!.currentMatch?.plannedDurationMinutes).toBe(minutes);
    });

    it("reads the bout's Tournament row before the Event's length", async () => {
      const { svc } = build(
        tablesWith(
          {},
          { tournaments: [{ tournamentId: TOURNAMENT, poolMatchDurationMinutes: 9 }] },
        ),
      );

      const out = await svc.getLiveBoard(req, EVENT);

      expect(out.rows[0]!.currentMatch?.plannedDurationMinutes).toBe(9);
    });

    it("takes the bout's own override over the sheet", async () => {
      const { svc } = build(tablesWith({ planned_duration_override_minutes: 13 }));

      const out = await svc.getLiveBoard(req, EVENT);

      expect(out.rows[0]!.currentMatch?.plannedDurationMinutes).toBe(13);
    });

    it("asks the bouts read for each bout's phase and override", async () => {
      // The seeded double answers whatever the projection names, so the columns
      // a length is resolved from are only proved by the string sent.
      const { svc, supabase } = build(tablesWith({}));

      await svc.getLiveBoard(req, EVENT);

      expect(selectsFor(supabase.from, 'matches')).toContain(
        'id,lice_id,status,red_score,blue_score,match_number_label,scheduled_at,started_at,ended_at,pool_id,phase_id,planned_duration_override_minutes,bracket_slots(round),swiss_rounds(round_number),pools(name),phases(type,tournaments(name)),red:registrations!matches_red_registration_id_fkey(persons(given_name,family_name)),blue:registrations!matches_blue_registration_id_fkey(persons(given_name,family_name))',
      );
    });
  });
});

describe('StaffService.acknowledgeAttention', () => {
  it('clears the flag on the named account, scoped to the event', async () => {
    const { svc, supabase } = build(boardTables());

    await expect(svc.acknowledgeAttention(req, EVENT, ACCOUNT)).resolves.toEqual({ ok: true });

    const [write] = writesTo(supabase, 'event_staff_accounts');
    expect(write?.row).toMatchObject({ needs_attention: false, needs_attention_reason: null });
    expect(scopedTo(write, 'event_id')).toBe(EVENT);
    expect(scopedTo(write, 'id')).toBe(ACCOUNT);
  });
});
