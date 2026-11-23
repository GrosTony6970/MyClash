/**
 * The clashes a person's own schedule page shows, worked out from the schedule read the API
 * serves (`GET events/:eventId/people/:personId/schedule`, `PersonSchedule` in
 * `apps/api/src/modules/persons/public-schedule.service.ts`).
 *
 * The rule is the public app's (`apps/web-public/src/components/me/conflicts.ts`:
 * `detectConflicts` over `fightItems`, `dutyTimed` and `workshopTimed`, as `ScheduleView.tsx`
 * builds them). It is restated here because the e2e runner loads no app code; a change there
 * must be made here too.
 *
 * - A fighter is busy for a whole block: their Pool's span, their bracket or Swiss phase's span.
 *   A span never clashes with its own bouts.
 * - A bout lasts its planned length; with none, it ends where the API fell back on. No end, no
 *   window: it takes no part.
 * - A referee duty, and a Workshop session (waitlisted too, not a cancelled one), are commitments.
 * - Two commitments clash when their windows overlap at all, half-open.
 */

export interface ScheduleRead {
  matches: Array<{
    id: string;
    roundCode: string;
    scheduledAt: string | null;
    durationMinutes: number | null;
    fallbackEndsAt: string | null;
    poolId: string | null;
    phaseId: string;
    phase: 'pool' | 'swiss' | 'bracket' | null;
    tournamentName: string | null;
  }>;
  poolSpans?: Array<{
    poolId: string;
    poolName: string | null;
    tournamentName: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  phaseSpans?: Array<{
    phaseId: string;
    kind: 'bracket' | 'swiss';
    tournamentName: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  refereeSlots: Array<{
    id: string;
    roundCode: string;
    tournamentName: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  /** Null: the person hides their Workshops publicly. */
  workshops: Array<{
    workshopId: string;
    workshopName: string;
    sessionStart: string | null;
    sessionEnd: string | null;
    sessionCancelled?: boolean;
  }> | null;
}

/** One commitment with a window. `dutyId` on a referee duty: what a clean-up drops. */
export interface Commitment {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
  blockOf?: string;
  spanOf?: string;
  dutyId?: string;
}

export interface Clash {
  a: Commitment;
  b: Commitment;
}

function timed(key: string, label: string, start: string | null, end: string | null) {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return { key, label, startMs, endMs };
}

const named = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · ');

/** The block a bout belongs to, as its span's key (`blockKeyOf`). */
function blockOf(match: ScheduleRead['matches'][number]): string | undefined {
  if (match.poolId) return `pool-${match.poolId}`;
  if ((match.phase === 'bracket' || match.phase === 'swiss') && match.phaseId) {
    return `phase-${match.phaseId}`;
  }
  return undefined;
}

/** A bout's planned window (`fightWindow`). */
function boutWindow(match: ScheduleRead['matches'][number]) {
  const startMs = match.scheduledAt ? Date.parse(match.scheduledAt) : NaN;
  if (!Number.isFinite(startMs)) return null;
  if (match.durationMinutes == null) {
    const endMs = match.fallbackEndsAt ? Date.parse(match.fallbackEndsAt) : NaN;
    return endMs > startMs ? { startMs, endMs } : null;
  }
  if (!(match.durationMinutes > 0)) return null;
  return { startMs, endMs: startMs + match.durationMinutes * 60_000 };
}

/**
 * Every timed commitment of the read. `extraWorkshops` stands in for `workshops` when the read
 * hides them: the caller's own record of the seats it gave.
 */
export function commitments(
  read: ScheduleRead,
  extraWorkshops: ScheduleRead['workshops'] = null,
): Commitment[] {
  const items: Commitment[] = [];
  for (const span of read.poolSpans ?? []) {
    const key = `pool-${span.poolId}`;
    const t = timed(key, named(span.poolName, span.tournamentName), span.startsAt, span.endsAt);
    if (t) items.push({ ...t, spanOf: key });
  }
  for (const span of read.phaseSpans ?? []) {
    const key = `phase-${span.phaseId}`;
    const t = timed(key, named(span.kind, span.tournamentName), span.startsAt, span.endsAt);
    if (t) items.push({ ...t, spanOf: key });
  }
  for (const match of read.matches) {
    const window = boutWindow(match);
    if (window) {
      const label = named(match.roundCode, match.tournamentName);
      items.push({ key: `bout-${match.id}`, label, ...window, blockOf: blockOf(match) });
    }
  }
  for (const duty of read.refereeSlots) {
    const label = named('referee', duty.roundCode, duty.tournamentName);
    const t = timed(`duty-${duty.id}`, label, duty.startsAt, duty.endsAt);
    if (t) items.push({ ...t, dutyId: duty.id });
  }
  for (const w of read.workshops ?? extraWorkshops ?? []) {
    if (w.sessionCancelled) continue;
    const t = timed(`ws-${w.workshopId}`, w.workshopName, w.sessionStart, w.sessionEnd);
    if (t) items.push(t);
  }
  return items;
}

/** A block's span covers its own bouts: never a clash (`covers`). */
const covers = (span: Commitment, bout: Commitment) =>
  span.spanOf !== undefined && span.spanOf === bout.blockOf;

/** Every pair that overlaps, half-open (`detectConflicts`). */
export function clashesOf(items: readonly Commitment[]): Clash[] {
  const clashes: Clash[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (covers(a, b) || covers(b, a)) continue;
      if (a.startMs < b.endMs && b.startMs < a.endMs) clashes.push({ a, b });
    }
  }
  return clashes;
}

/** Whether a window (a Workshop session) would clash with any of these commitments. */
export function windowClashes(
  items: readonly Commitment[],
  startMs: number,
  endMs: number,
): boolean {
  return items.some((item) => startMs < item.endMs && item.startMs < endMs);
}
