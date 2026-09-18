import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// Value imports, not `import type` — `import type` erases the DI metadata and
// the dependency arrives undefined at runtime.
import { OrganizationsService } from '../organizations/organizations.service';
import { MatchPlacementService } from '../matches/match-placement.service';
import { assertCanManageEvent } from '../../common/auth/event-authz';
import { assertMatchesBelongToEvent } from '../events/in-event';
import { readProgrammeSheet } from '../programme/programme-sheet';
import { embeddedOne, resolveMatchLengths, type Embedded } from './match-lengths';
import { plannedLengthOf, sheetRestFor } from './planned-length';
import { layRun, shiftRun, type LaidBout, type RunBout } from './lay-run';
import type { ScheduleRunDto } from './dto/schedule-run.dto';

interface RunRow {
  id: string;
  phase_id: string;
  pool_id: string | null;
  lice_id: string | null;
  scheduled_at: string | null;
  /** The bout's Tournament, for the rest its Pool takes: the sheet may carry a
   *  rest for this Tournament alone. Embedded on this read rather than read
   *  separately — `resolveMatchLengths` reads the same phases for its own
   *  reasons, so this saves a third round trip, not a second. */
  phases: Embedded<{ tournament_id: string }>;
}

type PlacedRunRow = RunRow & { lice_id: string; scheduled_at: string };

/**
 * The run window's save (ADR-018): one run of bouts moved to a start and, when
 * the organiser typed one, given a new bout length — laid out here and checked
 * by the placement owner as ONE batch.
 *
 * The grid used to send one PATCH per bout, all at once, each re-snapped to a
 * five-minute slot. The server checked each against neighbours that had not
 * moved yet, so a run could be refused or half-written depending on which
 * request it read first, and a typed length had no door at all. The browser
 * also lacks what laying a run needs: the sheet's gap, each bout's sheet length
 * when the field is emptied, and fresh rows after a Lice change in the same
 * save. So the browser sends the intent and the server lays the run.
 *
 * Only PLACED bouts take part — a bout with no piste or no time has no position
 * to keep or re-lay. Bouts already fought move with the rest (operator ruling).
 * A Pool's re-lay takes one rest break in the middle of each piste's queue, the
 * length of the sheet's rest for its Tournament. Generate and the re-fan take
 * the same break, measured over the Pool rather than the piste — ADR-018 says
 * where the two differ and why.
 * Not transactional, like every placement: the check is all-or-nothing, the
 * writes are per row, and a partial write says so.
 */
@Injectable()
export class ScheduleRunService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly placement: MatchPlacementService,
  ) {}

  async saveRun(eventId: string, dto: ScheduleRunDto, userId: string): Promise<{ placed: number }> {
    const db = this.supabase.service;
    await assertCanManageEvent({ supabase: this.supabase, orgs: this.orgs }, eventId, userId);
    await assertMatchesBelongToEvent(db, eventId, dto.matchIds);

    const { data, error } = await db
      .from('matches')
      .select('id, phase_id, pool_id, lice_id, scheduled_at, phases!inner(tournament_id)')
      .in('id', dto.matchIds);
    if (error) throw new BadRequestException(error.message);
    // `as unknown as`, like the membership read next door: the builder is
    // untyped, and the embed makes the two shapes disagree either way.
    const placed = ((data ?? []) as unknown as RunRow[]).filter(
      (row): row is PlacedRunRow => row.lice_id != null && row.scheduled_at != null,
    );
    if (placed.length === 0) {
      throw new BadRequestException('This run has no placed bout. Reload the schedule.');
    }

    const bouts: RunBout[] = placed.map((row) => ({
      id: row.id,
      liceId: row.lice_id,
      startMs: Date.parse(row.scheduled_at),
    }));
    const startMs = Date.parse(dto.startAt);
    const override = dto.plannedDurationOverrideMinutes;

    const laid =
      override === undefined
        ? shiftRun({ bouts, startMs })
        : await this.layAtLength(eventId, placed, bouts, startMs, override);

    await this.placement.placeMatches(
      eventId,
      laid.map((bout) => ({
        matchId: bout.id,
        liceId: bout.liceId,
        scheduledAt: bout.scheduledAt,
        ...(override === undefined ? {} : { plannedDurationOverrideMinutes: override }),
      })),
    );
    return { placed: laid.length };
  }

  /**
   * The run re-laid at the length being written: the typed number on every bout,
   * or — for `null` — each bout's sheet length for its own kind. The spacing is
   * that length plus the sheet's gap, and a Pool also takes the sheet's rest once,
   * in the middle of each piste's queue. An unreadable sheet refuses the save: a
   * write fails closed.
   *
   * A run is a Pool's when every placed bout names the same Pool, which is how the
   * board groups a Pool block. A Swiss or bracket round names none.
   */
  private async layAtLength(
    eventId: string,
    placed: readonly PlacedRunRow[],
    bouts: readonly RunBout[],
    startMs: number,
    override: number | null,
  ): Promise<LaidBout[]> {
    const db = this.supabase.service;
    const lengths = await resolveMatchLengths(
      db,
      eventId,
      placed.map((row) => ({
        id: row.id,
        phaseId: row.phase_id,
        plannedDurationOverrideMinutes: override,
      })),
    );
    const sheet = await readProgrammeSheet(db, eventId);
    const poolIds = new Set(placed.map((row) => row.pool_id));
    const isOnePool = poolIds.size === 1 && !poolIds.has(null);
    // One Pool sits in one Tournament, so the first row names it for the run.
    // `placed` is never empty here: `saveRun` refuses an unplaced run first.
    // An unreadable Tournament is a server fault, and it is refused rather than
    // quietly taking the Event's rest — a Pool that should run straight through
    // would otherwise be given a break nobody asked for.
    const tournamentId = embeddedOne(placed[0]!.phases)?.tournament_id;
    if (!tournamentId) {
      throw new BadRequestException('This run has no tournament. Reload the schedule.');
    }
    return layRun({
      bouts: bouts.map((bout) => ({ ...bout, lengthMinutes: plannedLengthOf(lengths, bout.id) })),
      startMs,
      gapMs: sheet.matchGapSeconds * 1000,
      midRestMs: isOnePool ? sheetRestFor(sheet, tournamentId) * 60_000 : 0,
    });
  }
}
