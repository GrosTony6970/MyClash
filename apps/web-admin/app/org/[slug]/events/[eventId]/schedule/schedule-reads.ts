import { apiRequest, type ApiFailure } from '@myclash/api-client';
import type {
  RefereeReason,
  RefereeSwitches,
  RefereeVerdict,
} from '@myclash/rulesets/scheduling/referee-checker';
import { DEFAULT_EVENT_TIMEZONE } from '@myclash/time';
import { eachDay } from '@myclash/schedule-core';
import type {
  RefereeConflictAssignment,
  RefereeConflictRegistration,
} from './referee-conflict-rows';
import type { Lice, ProgrammeBlockRow, ScheduleMatch } from './schedule-types';

/**
 * The one way the schedule surface reads from the API — the mirror of
 * ./schedule-mutations.
 *
 * Pure: no React, no i18n, no `apiUrl` knowledge beyond the argument. A refusal
 * is a value, not an exception, and it carries the STRUCTURED failure plus which
 * endpoint produced it. Turning that into prose an operator should read is the
 * hook's job, because only the hook has `t()`.
 *
 * It used to carry a `message` string built here: `body.message`, or the
 * invented English status line "502 Bad Gateway" when the body would not parse.
 * Both are what `@myclash/api-client` already answers, and answers better — the
 * RFC 9457 `detail` member, every field a validator rejected, and a word for a
 * refusal that never reached the API at all.
 *
 * This lives apart from `useScheduleData` so it can be tested without a
 * renderer. That is not a formality: the timezone resolution below is the sort
 * of thing three different test layers all fail to see (see the test file).
 */

/** The bootstrap fetches, in call order. A refusal is reported by name. */
export type BootstrapSource = 'lices' | 'schedule' | 'event' | 'programme';

/** GET /api/v1/events/:id resolves to `getEventBySlug`, which returns the raw
 *  Supabase row — snake_case. Don't paper over it with camelCase aliases
 *  unless the API mapping is unified. */
interface EventRow {
  start_date: string;
  end_date?: string | null;
  timezone?: string | null;
}

export interface ScheduleBootstrap {
  lices: Lice[];
  matches: ScheduleMatch[];
  days: string[];
  timezone: string;
  programmeBlocks: ProgrammeBlockRow[];
}

/** A refused read: which endpoint said no, and what it said. */
export interface ReadFailure {
  source: BootstrapSource;
  failure: ApiFailure;
}

export type BootstrapResult = { ok: true; data: ScheduleBootstrap } | ({ ok: false } & ReadFailure);

export type ReloadResult =
  | { ok: true; matches: ScheduleMatch[]; programmeBlocks: ProgrammeBlockRow[] }
  | ({ ok: false } & ReadFailure);

/**
 * The programme rows the grid draws as full-width bars: registration, gear
 * check, referee meeting, breaks. Competition and workshop blocks are skipped —
 * fights and workshops already come through the matches projection.
 */
export function barBlocksOnly(blocks: ProgrammeBlockRow[]): ProgrammeBlockRow[] {
  return blocks.filter((b) => b.blockType === 'admin' || b.blockType === 'break');
}

/** Load the four things the board needs to draw anything at all. */
export async function loadBootstrap(
  apiUrl: string,
  eventId: string,
  signal: AbortSignal,
): Promise<BootstrapResult> {
  const [lices, schedule, event, programme] = await Promise.all([
    apiRequest<Lice[]>(apiUrl, `/api/v1/events/${eventId}/lices`, { signal }),
    apiRequest<ScheduleMatch[]>(apiUrl, `/api/v1/events/${eventId}/schedule`, { signal }),
    apiRequest<EventRow>(apiUrl, `/api/v1/events/${eventId}`, { signal }),
    apiRequest<ProgrammeBlockRow[]>(apiUrl, `/api/v1/events/${eventId}/programme`, { signal }),
  ]);
  // Report the first refusal in fetch order, matching the sequential gates this
  // replaced. One banner, naming which endpoint refused.
  if (!lices.ok) return { ok: false, source: 'lices', failure: lices };
  if (!schedule.ok) return { ok: false, source: 'schedule', failure: schedule };
  if (!event.ok) return { ok: false, source: 'event', failure: event };
  if (!programme.ok) return { ok: false, source: 'programme', failure: programme };
  return {
    ok: true,
    data: {
      lices: lices.data.sort((a, b) => a.sortOrder - b.sortOrder),
      matches: schedule.data,
      // The event's own zone, never the app default when one is present. The
      // board's whole axis is built in it.
      timezone: event.data.timezone ?? DEFAULT_EVENT_TIMEZONE,
      days: eachDay(event.data.start_date, event.data.end_date ?? null),
      programmeBlocks: barBlocksOnly(programme.data),
    },
  };
}

export type RefereeConflictInputs = {
  assignments: RefereeConflictAssignment[];
  registrations: RefereeConflictRegistration[];
  /** The Event's amber switches, so the board grades a clash as the server does. */
  rules: RefereeSwitches;
};

export type RefereeConflictInputsResult =
  | ({ ok: true } & RefereeConflictInputs)
  /** `failure` is null when the server said yes and the body carried no switches. */
  | { ok: false; failure: ApiFailure | null };

/**
 * True only for the four Discouraged switches (ADR-016). Neither default is safe when
 * they are missing: `true` claims a rule ran, `false` claims it is off, and one of them
 * would be a statement about a payload that said nothing.
 */
function isSwitches(value: unknown): value is RefereeSwitches {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['ownPool'] === 'boolean' &&
    typeof r['ownPoolSpan'] === 'boolean' &&
    typeof r['twoRoles'] === 'boolean' &&
    typeof r['attendWorkshop'] === 'boolean' &&
    typeof r['restSlots'] === 'number' &&
    typeof r['maxBoutsPerDay'] === 'number'
  );
}

/**
 * Who referees what, what each organiser confirmed over, which person each registration
 * belongs to, and the amber switches — what the live check runs the one checker on.
 *
 * Deliberately NOT part of `loadBootstrap`. A refusal there blanks the whole
 * board, and this read is an addition to it: the operator can still schedule
 * fights without knowing the referee crews. The refusal is still a value rather
 * than a swallowed error, so the surface can say the referee check is
 * unavailable instead of showing an empty banner that reads as "all clear".
 */
export async function loadRefereeConflictInputs(
  apiUrl: string,
  eventId: string,
  signal: AbortSignal,
): Promise<RefereeConflictInputsResult> {
  const r = await apiRequest<Partial<RefereeConflictInputs>>(
    apiUrl,
    `/api/v1/events/${eventId}/referee-match-assignments`,
    { signal },
  );
  if (!r.ok) return { ok: false, failure: r };
  if (!isSwitches(r.data.rules)) return { ok: false, failure: null };
  return {
    ok: true,
    assignments: r.data.assignments ?? [],
    registrations: r.data.registrations ?? [],
    rules: r.data.rules,
  };
}

/**
 * One existing duty the one checker has something to say about — the API's
 * `RefereeConflictEntry`: red when Impossible, amber when Discouraged, each reason the
 * organiser already confirmed over marked `confirmed`.
 */
export interface RefereeCrewConflict {
  assignmentId: string;
  personId: string;
  personName: string;
  unitId: string;
  unitName: string;
  tournamentId: string;
  role: string;
  start: string | null;
  level: RefereeVerdict['level'];
  reasons: RefereeReason[];
}

export interface RefereeCrewConflictsBody {
  conflicts: RefereeCrewConflict[];
  /** The Discouraged switches when the server looked. The Impossible rules have none. */
  rules: RefereeSwitches;
  /** ISO, server-side: when these were computed. */
  asOf: string;
}

export type RefereeCrewConflictsResult =
  | ({ ok: true } & RefereeCrewConflictsBody)
  /**
   * `failure` is null for the second way this read can fail to answer: the
   * server said yes and the body could not be used. There is no status to
   * report for that, and inventing one would read as a refusal the API never
   * sent.
   */
  | { ok: false; failure: ApiFailure | null };

/** True only for a body that carries the verdicts AND the four switches (`isSwitches`). */
function hasCrewShape(body: unknown): body is RefereeCrewConflictsBody {
  if (typeof body !== 'object' || body === null) return false;
  const { conflicts, rules } = body as { conflicts?: unknown; rules?: unknown };
  return Array.isArray(conflicts) && isSwitches(rules);
}

/**
 * The server's verdicts on every existing duty, and whether anybody was looking.
 *
 * The slim read, not `referee-assignment-board`: that one returns the whole
 * referee workspace, and this is re-read after every card move.
 *
 * `rules` is why the banner can be honest: each amber rule has its own switch in the
 * referee settings, so no amber row may mean the check is off.
 */
export async function loadRefereeCrewConflicts(
  apiUrl: string,
  eventId: string,
  signal?: AbortSignal,
): Promise<RefereeCrewConflictsResult> {
  const r = await apiRequest<unknown>(
    apiUrl,
    `/api/v1/events/${eventId}/referee-crew-conflicts`,
    signal ? { signal } : {},
  );
  if (!r.ok) return { ok: false, failure: r };
  if (!hasCrewShape(r.data)) return { ok: false, failure: null };
  return {
    ok: true,
    conflicts: r.data.conflicts,
    rules: r.data.rules,
    asOf: r.data.asOf ?? '',
  };
}

/** Re-read the two things a write can change. Also the rollback path. */
export async function loadScheduleAndProgramme(
  apiUrl: string,
  eventId: string,
): Promise<ReloadResult> {
  const [schedule, programme] = await Promise.all([
    apiRequest<ScheduleMatch[]>(apiUrl, `/api/v1/events/${eventId}/schedule`),
    apiRequest<ProgrammeBlockRow[]>(apiUrl, `/api/v1/events/${eventId}/programme`),
  ]);
  // Named, where it used to report a bare status: a refused programme read said
  // "Schedule: 403", which sends the operator to look at the wrong endpoint.
  if (!schedule.ok) return { ok: false, source: 'schedule', failure: schedule };
  if (!programme.ok) return { ok: false, source: 'programme', failure: programme };
  return {
    ok: true,
    matches: schedule.data,
    programmeBlocks: barBlocksOnly(programme.data),
  };
}
