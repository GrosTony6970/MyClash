/**
 * Server-only loader for the public tournament-schedule timeline grid.
 *
 * Fetches the event's matches (/schedule), lices (/lices) and programme bars
 * (/programme) from the internal API, builds the per-pool / per-round BLOCK
 * model with the shared @myclash/schedule-core logic, and returns a compact,
 * PII-FREE projection for the client grid. Fighter names and registration ids
 * never leave the server — a block only needs its label, span, times and count.
 *
 * Uses `fetch` with `cache: 'no-store'` (mirrors home/_lib/public-event-data).
 */

import { zonedDay } from '@myclash/time';
import {
  buildScheduleBlocks,
  computeGridEndSlot,
  eachDay,
  hhmmToSlot,
  isoToSlot,
  GRID_START_HOUR,
  SLOT_MINUTES,
  type BlockMatchInput,
} from '@myclash/schedule-core';
import { fetchEventInfo } from '../../../_components/EventHeader';

/** Raw /schedule row (subset we consume — see api ScheduleGridMatch). */
interface RawMatch {
  id: string;
  liceId: string | null;
  scheduledAt: string | null;
  poolId: string | null;
  poolName: string | null;
  roundCode?: string;
  phaseType: string | null;
  tournamentName: string | null;
  tournamentColor: string | null;
  tournamentSlug: string | null;
  durationMinutes?: number;
  status?: string;
}

/** Raw /lices row (snake_case columns + venues embed — no camelCase interceptor). */
interface RawLice {
  id: string;
  name: string;
  sort_order: number | null;
  venues: { id: string; name: string } | null;
}

/** Raw /programme row (camelCase ProgrammeBlock). */
interface RawProgrammeBlock {
  id: string;
  dayIndex: number;
  blockType: string;
  label: string;
  startTime: string;
  endTime: string;
  colorHex: string | null;
}

export interface GridDay {
  index: number;
  /** YYYY-MM-DD in the event timezone — the axis anchor key for this day. */
  dayKey: string;
}

export interface GridLice {
  id: string;
  name: string;
  venues: { id: string; name: string } | null;
}

export interface GridBlock {
  key: string;
  dayIndex: number;
  liceIds: string[];
  label: string;
  tournamentName: string | null;
  tournamentColor: string | null;
  tournamentSlug: string | null;
  kind: 'pool' | 'bracket' | 'other';
  startIso: string;
  endIso: string;
  matchCount: number;
}

export interface GridBreak {
  id: string;
  dayIndex: number;
  label: string;
  startSlot: number;
  span: number;
  startTime: string;
  endTime: string;
  /** 'admin' | 'break' — drives the bar tint. */
  kind: string;
  colorHex: string | null;
}

export interface GridTournament {
  name: string;
  color: string | null;
  slug: string | null;
}

export interface TournamentScheduleData {
  tz: string;
  days: GridDay[];
  lices: GridLice[];
  blocks: GridBlock[];
  breaks: GridBreak[];
  /** Vertical extent (slot index) per day, indexed by dayIndex. */
  gridEndByDay: number[];
  /** Distinct tournaments present in the schedule — for the color legend. */
  tournaments: GridTournament[];
  /** Day tab to open on — today if the event is running, else the first day.
   *  Resolved server-side so SSR and hydration agree (no client `Date`). */
  initialDayIndex: number;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** End slot for a break's HH:MM end, rounded UP, at least one slot past start. */
function breakEndSlot(hhmm: string, startSlot: number): number {
  const [h, m] = hhmm.split(':').map((s) => Number(s));
  const endMin = (h ?? 0) * 60 + (m ?? 0) - GRID_START_HOUR * 60;
  return Math.max(startSlot + 1, Math.max(0, Math.ceil(endMin / SLOT_MINUTES)));
}

export async function loadTournamentSchedule(
  eventSlug: string,
  apiUrl: string,
): Promise<TournamentScheduleData | null> {
  const event = await fetchEventInfo(eventSlug, apiUrl);
  if (!event?.id) return null;
  const tz = event.timezone || 'Europe/Paris';

  const base = `${apiUrl}/api/v1/events/${event.id}`;
  const [matches, licesRaw, programme] = await Promise.all([
    fetchJson<RawMatch[]>(`${base}/schedule`),
    fetchJson<RawLice[]>(`${base}/lices`),
    fetchJson<RawProgrammeBlock[]>(`${base}/programme`),
  ]);

  const lices: GridLice[] = [...(licesRaw ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((l) => ({ id: l.id, name: l.name, venues: l.venues ?? null }));

  const days: GridDay[] = eachDay(
    (event.startDate || '').slice(0, 10),
    event.endDate ? event.endDate.slice(0, 10) : null,
  ).map((dayKey, index) => ({ index, dayKey }));

  // tournamentName → identity (color + slug) for block tint + linking. Names
  // are unique within an event; slug/color come off the match projection.
  const tournamentByName = new Map<string, GridTournament>();
  for (const m of matches ?? []) {
    if (m.tournamentName && !tournamentByName.has(m.tournamentName)) {
      tournamentByName.set(m.tournamentName, {
        name: m.tournamentName,
        color: m.tournamentColor ?? null,
        slug: m.tournamentSlug ?? null,
      });
    }
  }

  // Blocks: per day, filter matches to that day (event-tz bucket → same key the
  // axis geometry uses), collapse into pool/round runs, strip PII.
  const blocks: GridBlock[] = [];
  for (const day of days) {
    const dayMatches = (matches ?? []).filter(
      (m) => m.scheduledAt && zonedDay(m.scheduledAt, tz) === day.dayKey,
    );
    const inputs: BlockMatchInput[] = dayMatches.map((m) => ({
      id: m.id,
      liceId: m.liceId,
      scheduledAt: m.scheduledAt,
      poolId: m.poolId,
      poolName: m.poolName,
      roundCode: m.roundCode,
      phaseType: m.phaseType,
      tournamentName: m.tournamentName,
      tournamentSlug: m.tournamentSlug ?? null,
      // PII deliberately dropped — the block view never shows fighters.
      redFighterName: null,
      blueFighterName: null,
      durationMinutes: m.durationMinutes,
      status: m.status,
    }));
    for (const b of buildScheduleBlocks(inputs)) {
      blocks.push({
        key: `${day.index}:${b.key}`,
        dayIndex: day.index,
        liceIds: b.liceIds,
        label: b.label,
        tournamentName: b.tournamentName,
        tournamentColor: b.tournamentName
          ? (tournamentByName.get(b.tournamentName)?.color ?? null)
          : null,
        tournamentSlug: b.tournamentSlug,
        kind: b.kind,
        startIso: b.startIso,
        endIso: b.endIso,
        matchCount: b.matchCount,
      });
    }
  }

  // Break / ceremony bars (registration, gear check, referee meeting, lunch).
  // Bucketed by the programme block's own 0-based dayIndex.
  const breaks: GridBreak[] = [];
  for (const p of programme ?? []) {
    if (p.blockType !== 'admin' && p.blockType !== 'break') continue;
    if (p.dayIndex < 0 || p.dayIndex >= days.length) continue;
    const startSlot = hhmmToSlot(p.startTime);
    const endSlot = breakEndSlot(p.endTime, startSlot);
    breaks.push({
      id: p.id,
      dayIndex: p.dayIndex,
      label: p.label,
      startSlot,
      span: endSlot - startSlot,
      startTime: p.startTime,
      endTime: p.endTime,
      kind: p.blockType,
      colorHex: p.colorHex ?? null,
    });
  }

  // Per-day vertical extent from that day's block + break ends and the latest
  // programme end time.
  const gridEndByDay = days.map((day) => {
    const dayBlocks = blocks.filter((b) => b.dayIndex === day.index);
    const dayBreaks = breaks.filter((b) => b.dayIndex === day.index);
    const dayProgramme = (programme ?? []).filter((p) => p.dayIndex === day.index);
    const dayEndHHMM =
      dayProgramme.length > 0
        ? dayProgramme.reduce((max, p) => (p.endTime > max ? p.endTime : max), '00:00')
        : null;
    return computeGridEndSlot({
      blockEndSlots: dayBlocks.map((b) => isoToSlot(b.endIso, day.dayKey, tz)),
      breakEndSlots: dayBreaks.map((b) => b.startSlot + b.span),
      dayEndHHMM,
    });
  });

  // Open on today's tab when the event is running, else the first day.
  const todayKey = zonedDay(new Date().toISOString(), tz);
  const todayIndex = days.findIndex((d) => d.dayKey === todayKey);
  const initialDayIndex = todayIndex >= 0 ? todayIndex : 0;

  return {
    tz,
    days,
    lices,
    blocks,
    breaks,
    gridEndByDay,
    tournaments: [...tournamentByName.values()],
    initialDayIndex,
  };
}
