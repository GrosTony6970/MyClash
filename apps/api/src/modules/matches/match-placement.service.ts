import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MatchAlertRefresherService } from '../notifications/match-alert-refresher.service';
import { assertLicesBelongToEvent } from '../lices/lices-in-event';
import { resolveMatchLengths } from '../schedule/match-lengths';
import { plannedLengthOf } from '../schedule/planned-length';
import { findLiceCollisions, liceCollisionMessage } from './lice-occupancy';

/**
 * Putting a Match on a piste at a time — every door, one owner.
 *
 * There were five doors and three of them checked nothing. The grid's drag
 * (`scheduleMatch`) and a Pool re-time (`reschedulePool`) each read the piste's
 * occupants and refused a clash; `createMatch`, the AI assistant's
 * `schedule_match` and the re-fan wrote the same two columns with no occupancy
 * check at all, so a bout created onto a busy strip, or dropped there by the
 * assistant, was accepted in silence.
 *
 * What a door has to get right is the same every time: the Lice is this Event's
 * (0197 is the database's backstop), the time is readable, the strip is free for
 * the whole of the bout's PLANNED length rather than an assumed five minutes,
 * the rows of one batch are checked against each other as well as against what
 * is already there, and the fighters' alerts are refreshed once for what was
 * actually written. Five copies of that is five chances to get one of them
 * wrong, which is what happened.
 *
 * No authorization here, and every write goes through the service role with RLS
 * bypassed: each caller decides who may place before it calls, exactly as
 * `readProgrammeSheet` and `assertLicesBelongToEvent` do.
 *
 * ADR-017: a Lice is judged on its Matches, and a Match's window is
 * `[start, start + planned length)`. The planned length comes from the Event's
 * sheet through `resolveMatchLengths`, so a re-drop that did not move can now
 * refuse — the organiser lengthened the bouts and the strip no longer fits
 * them. That is the sheet being believed, not a regression.
 */

/** One row of a batch: where a Match is being put, or being taken off a piste. */
export interface MatchPlacement {
  /** Null for a Match that does not exist yet — `createMatch` checking first. */
  matchId: string | null;
  liceId: string | null;
  scheduledAt: string | null;
  /** Only for a Match that does not exist yet; existing ones are read. */
  phaseId?: string;
}

export interface PlaceMatchesOptions {
  /** Check and report, write nothing. `createMatch` asks before it inserts. */
  checkOnly?: true;
}

interface StoredMatch {
  id: string;
  phase_id: string;
  planned_duration_override_minutes: number | null;
}

interface OccupantRow extends StoredMatch {
  lice_id: string | null;
  scheduled_at: string | null;
}

/**
 * A placement holds a strip only when it names BOTH a piste and a time.
 *
 * Naming a piste without a time is a real half-step — "assign the pistes now,
 * fix the clock after" — and it cannot collide with anything. It is still a
 * Lice the caller chose, so it is still checked against the Event; only the
 * occupancy test needs both halves.
 */
function occupiesAStrip(placement: MatchPlacement): boolean {
  return Boolean(placement.liceId) && Boolean(placement.scheduledAt);
}

/**
 * The id a proposed placement is known by while it is being checked.
 *
 * Only `createMatch` produces one, and only with `checkOnly`, so it never
 * reaches a write. Not a valid uuid, so it cannot equal a real Match id: the
 * batch excludes itself from the occupant list by id, and a placeholder that
 * collided with a real row would exclude the wrong one.
 */
const PENDING_ID = '__pending__';

/**
 * What the length helper needs for one placement.
 *
 * The override is read from the row, never taken from the caller: no door sends
 * one today, and a parameter with no producer is a branch that cannot fire.
 * A Match that does not exist yet has no row, which is why `phaseId` is on the
 * placement at all — and no override either, so it takes the sheet's length.
 */
function lengthInputFor(placement: MatchPlacement, stored: Map<string, StoredMatch>) {
  const id = placement.matchId ?? PENDING_ID;
  return {
    id,
    phaseId: placement.phaseId ?? (stored.get(id)?.phase_id as string),
    plannedDurationOverrideMinutes: stored.get(id)?.planned_duration_override_minutes ?? null,
  };
}

@Injectable()
export class MatchPlacementService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly matchAlerts: MatchAlertRefresherService,
  ) {}

  async placeMatches(
    eventId: string,
    placements: readonly MatchPlacement[],
    opts: PlaceMatchesOptions = {},
  ): Promise<void> {
    if (placements.length === 0) return;

    for (const placement of placements) {
      if (placement.scheduledAt != null && !Number.isFinite(Date.parse(placement.scheduledAt))) {
        // Before `matchWindowMs`, which throws a RangeError — a scrubbed 500.
        // The AI door hands us `String(action['scheduledAt'])` unvalidated.
        throw new BadRequestException(`Cannot read the time "${placement.scheduledAt}"`);
      }
    }

    // Every Lice the caller named, whether or not a time came with it. Scoping
    // this to the placements that also carry a time would drop the check on a
    // piste-only assignment — `createMatch` with no `scheduledAt` is the common
    // case — and leave migration 0197's trigger to refuse it in raw Postgres.
    const named = placements.filter((placement) => placement.liceId != null);
    if (named.length > 0) {
      await assertLicesBelongToEvent(
        this.supabase.service,
        eventId,
        named.map((placement) => placement.liceId),
      );
    }

    const occupying = placements.filter(occupiesAStrip);
    if (occupying.length > 0) {
      await this.assertNoCollision(eventId, placements, occupying);
    }

    if (opts.checkOnly) return;
    await this.write(placements);
  }

  /** The stored rows of the batch, keyed by id. A missing id is a 404. */
  private async loadBatch(ids: readonly string[]): Promise<Map<string, StoredMatch>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, phase_id, planned_duration_override_minutes')
      .in('id', ids);
    if (error) throw new BadRequestException(error.message);
    const rows = new Map(((data ?? []) as StoredMatch[]).map((row) => [row.id, row]));
    for (const id of ids) {
      if (!rows.has(id)) throw new NotFoundException(`Match ${id} not found`);
    }
    return rows;
  }

  /**
   * What already holds those pistes, minus the rows being moved.
   *
   * The batch's own rows are dropped, or a bout collides with where it used to
   * sit and every re-save refuses. A voided bout keeps its piste and its time on
   * the row and nothing in `lice-occupancy` reads status, so
   * `.not('status','eq','voided')` is the only thing stopping a cancelled bout
   * from holding a strip for the rest of the day.
   */
  private async readOccupants(
    liceIds: readonly string[],
    stored: Map<string, StoredMatch>,
  ): Promise<OccupantRow[]> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, phase_id, lice_id, scheduled_at, planned_duration_override_minutes')
      .in('lice_id', liceIds)
      .not('scheduled_at', 'is', null)
      .not('status', 'eq', 'voided');
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as OccupantRow[]).filter((row) => !stored.has(row.id));
  }

  private async assertNoCollision(
    eventId: string,
    placements: readonly MatchPlacement[],
    occupying: readonly MatchPlacement[],
  ): Promise<void> {
    const batchIds = placements
      .map((placement) => placement.matchId)
      .filter((id): id is string => id != null);
    const stored = await this.loadBatch(batchIds);

    const occupants = await this.readOccupants(
      [...new Set(occupying.map((placement) => placement.liceId as string))],
      stored,
    );

    const lengths = await resolveMatchLengths(this.supabase.service, eventId, [
      ...occupying.map((placement) => lengthInputFor(placement, stored)),
      ...occupants.map((row) => ({
        id: row.id,
        phaseId: row.phase_id,
        plannedDurationOverrideMinutes: row.planned_duration_override_minutes,
      })),
    ]);

    const collisions = findLiceCollisions(
      occupying.map((placement) => {
        const id = placement.matchId ?? PENDING_ID;
        return {
          matchId: id,
          liceId: placement.liceId,
          scheduledAt: placement.scheduledAt,
          durationMinutes: plannedLengthOf(lengths, id),
        };
      }),
      occupants.map((row) => ({
        matchId: row.id,
        liceId: row.lice_id,
        scheduledAt: row.scheduled_at,
        durationMinutes: plannedLengthOf(lengths, row.id),
      })),
    );
    if (collisions.length > 0) throw new ConflictException(liceCollisionMessage(collisions));
  }

  /**
   * Write each row, then refresh the alerts ONCE for what committed.
   *
   * `allSettled`, not `all`: a batch that stops at the first rejection leaves
   * the rows before it written and the fighters' alerts stale for all of them.
   * The rejection's own message is carried out, because the database explains
   * itself there — 0197's trigger on a foreign Lice and 0196's CHECK on a
   * planned length both arrive as text.
   */
  private async write(placements: readonly MatchPlacement[]): Promise<void> {
    const updatedAt = new Date().toISOString();
    const rows = placements.filter((placement) => placement.matchId != null);
    const results = await Promise.allSettled(
      rows.map(async (placement) => {
        const updates: Record<string, unknown> = {
          lice_id: placement.liceId || null,
          scheduled_at: placement.scheduledAt || null,
          updated_at: updatedAt,
        };
        const { error } = await this.supabase.service
          .from('matches')
          .update(updates)
          .eq('id', placement.matchId as string);
        if (error) throw new Error(error.message);
      }),
    );

    const committed = rows
      .filter((_, index) => results[index]?.status === 'fulfilled')
      .map((placement) => placement.matchId as string);
    if (committed.length > 0) await this.matchAlerts.refresh(committed);

    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length > 0) {
      const first = failed[0] as PromiseRejectedResult;
      throw new BadRequestException(
        `${rows.length - failed.length}/${rows.length} placements applied. ` +
          `Reload the schedule before retrying. First failure: ${
            (first.reason as Error)?.message ?? String(first.reason)
          }`,
      );
    }
  }
}
