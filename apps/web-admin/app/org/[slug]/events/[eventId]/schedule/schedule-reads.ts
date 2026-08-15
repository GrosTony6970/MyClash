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
 * is a value, not an exception, and it carries only what the server said plus
 * which endpoint said it. Turning that into prose an operator should read is
 * the hook's job, because only the hook has `t()`.
 *
 * This lives apart from `useScheduleData` so it can be tested without a
 * renderer. That is not a formality: the timezone resolution below is the sort
 * of thing three different test layers all fail to see (see the test file).
 */

/** The bootstrap fetches, in call order. A refusal is reported by name. */
export const BOOTSTRAP_SOURCES = ['lices', 'schedule', 'event', 'programme'] as const;
export type BootstrapSource = (typeof BOOTSTRAP_SOURCES)[number];

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

export type BootstrapResult =
  { ok: true; data: ScheduleBootstrap } | { ok: false; source: BootstrapSource; message: string };

export type ReloadResult =
  | { ok: true; matches: ScheduleMatch[]; programmeBlocks: ProgrammeBlockRow[] }
  | { ok: false; status: number };

/**
 * The programme rows the grid draws as full-width bars: registration, gear
 * check, referee meeting, breaks. Competition and workshop blocks are skipped —
 * fights and workshops already come through the matches projection.
 */
export function barBlocksOnly(blocks: ProgrammeBlockRow[]): ProgrammeBlockRow[] {
  return blocks.filter((b) => b.blockType === 'admin' || b.blockType === 'break');
}

/** The upstream NestJS message, so the operator sees the real DB/auth/schema
 *  error rather than staring at an empty grid. */
async function bodyMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

/** Load the four things the board needs to draw anything at all. */
export async function loadBootstrap(
  apiUrl: string,
  eventId: string,
  signal: AbortSignal,
): Promise<BootstrapResult> {
  const init = { credentials: 'include' as const, signal };
  const responses = await Promise.all([
    fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, init),
    fetch(`${apiUrl}/api/v1/events/${eventId}/schedule`, init),
    fetch(`${apiUrl}/api/v1/events/${eventId}`, init),
    fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, init),
  ]);
  // Report the first non-OK in fetch order, matching the sequential gates this
  // replaced. One banner, naming which endpoint refused.
  for (const [index, res] of responses.entries()) {
    const source = BOOTSTRAP_SOURCES[index];
    if (!res.ok && source) return { ok: false, source, message: await bodyMessage(res) };
  }
  const [licesRes, schedRes, eventRes, programmeRes] = responses as [
    Response,
    Response,
    Response,
    Response,
  ];
  const lices = (await licesRes.json()) as Lice[];
  const matches = (await schedRes.json()) as ScheduleMatch[];
  const ev = (await eventRes.json()) as EventRow;
  const blocks = (await programmeRes.json()) as ProgrammeBlockRow[];
  return {
    ok: true,
    data: {
      lices: lices.sort((a, b) => a.sortOrder - b.sortOrder),
      matches,
      // The event's own zone, never the app default when one is present. The
      // board's whole axis is built in it.
      timezone: ev.timezone ?? DEFAULT_EVENT_TIMEZONE,
      days: eachDay(ev.start_date, ev.end_date ?? null),
      programmeBlocks: barBlocksOnly(blocks),
    },
  };
}

export type RefereeConflictInputs = {
  assignments: RefereeConflictAssignment[];
  registrations: RefereeConflictRegistration[];
};

export type RefereeConflictInputsResult =
  ({ ok: true } & RefereeConflictInputs) | { ok: false; status: number };

/**
 * Who referees what, and which person each registration belongs to.
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
  const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/referee-match-assignments`, {
    credentials: 'include',
    signal,
  });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json()) as RefereeConflictInputs;
  return { ok: true, assignments: body.assignments ?? [], registrations: body.registrations ?? [] };
}

/** Re-read the two things a write can change. Also the rollback path. */
export async function loadScheduleAndProgramme(
  apiUrl: string,
  eventId: string,
): Promise<ReloadResult> {
  const [schedRes, programmeRes] = await Promise.all([
    fetch(`${apiUrl}/api/v1/events/${eventId}/schedule`, { credentials: 'include' }),
    fetch(`${apiUrl}/api/v1/events/${eventId}/programme`, { credentials: 'include' }),
  ]);
  if (!schedRes.ok || !programmeRes.ok) {
    return { ok: false, status: (schedRes.ok ? programmeRes : schedRes).status };
  }
  return {
    ok: true,
    matches: (await schedRes.json()) as ScheduleMatch[],
    programmeBlocks: barBlocksOnly((await programmeRes.json()) as ProgrammeBlockRow[]),
  };
}
