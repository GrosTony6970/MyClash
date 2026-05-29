'use client';

/* eslint-disable myclash/no-literal-string */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

interface Lice {
  id: string;
  name: string;
  sortOrder: number;
}

interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  liceId: string | null;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redRegistrationId: string;
  blueRegistrationId: string;
  tournamentName: string | null;
  durationMinutes: number;
  phaseType: string | null;
}

interface Conflict {
  matchA: string;
  matchB: string;
  personName: string;
  time: string;
}

const SLOT_MINUTES = 5;
const GRID_START_HOUR = 8;
const GRID_END_HOUR = 20;
const TOTAL_SLOTS = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MINUTES;
const SLOT_HEIGHT_PX = 16;
const TIME_LABEL_COL_PX = 64;
const MIN_LICE_COL_PX = 140;

function minutesToSlot(minutes: number): number {
  return Math.floor(minutes / SLOT_MINUTES);
}

function slotToTime(slot: number, baseDate: string): string {
  const base = new Date(baseDate);
  base.setHours(GRID_START_HOUR, 0, 0, 0);
  base.setMinutes(base.getMinutes() + slot * SLOT_MINUTES);
  return base.toISOString();
}

function isoToSlot(iso: string, baseDate: string): number {
  const base = new Date(baseDate);
  base.setHours(GRID_START_HOUR, 0, 0, 0);
  const diff = (new Date(iso).getTime() - base.getTime()) / 60_000;
  return Math.max(0, minutesToSlot(diff));
}

function formatSlotTime(slot: number): string {
  const totalMin = GRID_START_HOUR * 60 + slot * SLOT_MINUTES;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Return every ISO date (YYYY-MM-DD) between start and end inclusive.
 * Falls back to [start] when end is missing or earlier than start.
 */
function eachDay(start: string, end: string | null | undefined): string[] {
  if (!start) return [];
  if (!end || end < start) return [start];
  const days: string[] = [];
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days.length > 0 ? days : [start];
}

/** Day-of-week + DD MMM, French locale (the rest of the admin app is FR-leaning). */
function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** True when `scheduledAtIso` falls on the same calendar day (UTC) as `dayIso`. */
function matchBelongsToDay(scheduledAtIso: string | null, dayIso: string): boolean {
  if (!scheduledAtIso) return false;
  return scheduledAtIso.slice(0, 10) === dayIso;
}

function detectConflicts(matches: ScheduleMatch[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const scheduled = matches.filter((m) => m.scheduledAt && m.liceId);

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i]!;
      const b = scheduled[j]!;
      const aFighters = [a.redRegistrationId, a.blueRegistrationId].filter(Boolean);
      const bFighters = [b.redRegistrationId, b.blueRegistrationId].filter(Boolean);
      const shared = aFighters.filter((f) => bFighters.includes(f));
      if (shared.length === 0) continue;
      const aStart = new Date(a.scheduledAt!).getTime();
      const aEnd = aStart + a.durationMinutes * 60_000;
      const bStart = new Date(b.scheduledAt!).getTime();
      const bEnd = bStart + b.durationMinutes * 60_000;
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push({
          matchA: a.matchNumberLabel,
          matchB: b.matchNumberLabel,
          personName:
            shared[0] === a.redRegistrationId
              ? (a.redFighterName ?? shared[0]!)
              : (a.blueFighterName ?? shared[0]!),
          time: new Date(a.scheduledAt!).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        });
      }
    }
  }
  return conflicts;
}

export function ScheduleGrid({ eventId }: { slug: string; eventId: string }) {
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [lices, setLices] = useState<Lice[]>([]);
  const [matches, setMatches] = useState<ScheduleMatch[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [activeDay, setActiveDay] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const dragMatch = useRef<ScheduleMatch | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}/schedule`, {
        credentials: 'include',
        signal: controller.signal,
      }),
      fetch(`${apiUrl}/api/v1/events/${eventId}`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    ])
      .then(async ([licesRes, schedRes, eventRes]) => {
        setLoading(false);
        if (licesRes.ok) {
          const l = (await licesRes.json()) as Lice[];
          setLices(l.sort((a, b) => a.sortOrder - b.sortOrder));
        }
        if (schedRes.ok) {
          const m = (await schedRes.json()) as ScheduleMatch[];
          setMatches(m);
          setConflicts(detectConflicts(m));
        }
        if (eventRes.ok) {
          // GET /api/v1/events/:id resolves to `getEventBySlug` which returns
          // the raw Supabase row — snake_case fields. Don't paper over it
          // with `startDate` aliases unless the API mapping is unified.
          const ev = (await eventRes.json()) as {
            start_date: string;
            end_date?: string | null;
          };
          const eventDays = eachDay(ev.start_date, ev.end_date ?? null);
          setDays(eventDays);
          if (eventDays[0]) setActiveDay(eventDays[0]);
        }
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventId, apiUrl]);

  async function saveMatchPosition(matchId: string, liceId: string, scheduledAt: string) {
    setSaving(matchId);
    try {
      await fetch(`${apiUrl}/api/v1/matches/${matchId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ liceId, scheduledAt }),
      });
    } finally {
      setSaving(null);
    }
  }

  function handleDrop(liceId: string, slot: number) {
    const match = dragMatch.current;
    if (!match || !activeDay) return;
    const newScheduledAt = slotToTime(slot, activeDay);
    const updated = matches.map((m) =>
      m.id === match.id ? { ...m, liceId, scheduledAt: newScheduledAt } : m,
    );
    setMatches(updated);
    setConflicts(detectConflicts(updated));
    void saveMatchPosition(match.id, liceId, newScheduledAt);
    dragMatch.current = null;
  }

  const unscheduled = useMemo(() => matches.filter((m) => !m.scheduledAt || !m.liceId), [matches]);
  const scheduledOnActiveDay = useMemo(
    () =>
      matches.filter(
        (m) => m.scheduledAt && m.liceId && matchBelongsToDay(m.scheduledAt, activeDay),
      ),
    [matches, activeDay],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Day tabs — one per event day. Even on a single-day event we render
          a non-clickable label so the operator always sees which day the
          grid is showing. Multi-day events get a clickable pill per day
          that switches activeDay. */}
      {days.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {days.map((day, idx) => {
            const active = day === activeDay;
            const single = days.length === 1;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setActiveDay(day)}
                disabled={single}
                className={[
                  'rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors',
                  active
                    ? 'border-red-700 bg-red-700 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400',
                  single ? 'cursor-default' : '',
                ].join(' ')}
              >
                {single ? formatDayLabel(day) : `Jour ${idx + 1} · ${formatDayLabel(day)}`}
              </button>
            );
          })}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 mb-6 text-sm">
          <p className="font-bold text-red-700 mb-1">
            ⚠ {conflicts.length} scheduling conflict{conflicts.length !== 1 ? 's' : ''}
          </p>
          <ul className="list-disc list-inside text-red-600 space-y-0.5">
            {conflicts.map((c, i) => (
              <li key={i}>
                <strong>{c.personName}</strong> is in both <em>{c.matchA}</em> and{' '}
                <em>{c.matchB}</em> at {c.time}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Unscheduled sidebar — global across all days. */}
        <div className="w-full lg:w-56 lg:flex-shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
            Unscheduled ({unscheduled.length})
          </h2>
          <div
            className="flex flex-col gap-1.5 min-h-[100px] border-2 border-dashed border-gray-200 rounded-xl p-2 max-h-[60vh] overflow-y-auto"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const match = dragMatch.current;
              if (!match) return;
              const updated = matches.map((m) =>
                m.id === match.id ? { ...m, liceId: null, scheduledAt: null } : m,
              );
              setMatches(updated);
              setConflicts(detectConflicts(updated));
              void saveMatchPosition(match.id, '', '');
              dragMatch.current = null;
            }}
          >
            {unscheduled.length === 0 ? (
              <p className="px-1 py-2 text-xs italic text-gray-400">
                All matches placed on the grid.
              </p>
            ) : (
              unscheduled.map((m) => (
                <MatchChip
                  key={m.id}
                  match={m}
                  saving={saving === m.id}
                  onDragStart={() => {
                    dragMatch.current = m;
                  }}
                />
              ))
            )}
          </div>
        </div>

        {/* Day grid — lice as columns, time as rows. Columns flex to fill the canvas. */}
        <div className="flex-1 min-w-0 overflow-x-auto">
          {lices.length === 0 ? (
            <p className="text-gray-400 text-sm">No Lices configured for this event.</p>
          ) : !activeDay ? (
            <p className="text-gray-400 text-sm">No event date available.</p>
          ) : (
            <div
              className="relative grid w-full"
              style={{
                gridTemplateColumns: `${TIME_LABEL_COL_PX}px repeat(${lices.length}, minmax(${MIN_LICE_COL_PX}px, 1fr))`,
                gridAutoRows: `${SLOT_HEIGHT_PX}px`,
              }}
            >
              {/* Row 1: header — corner cell + lice name cells. Every cell is
                  explicitly placed so the per-slot Fragment below can't be
                  cascaded out of position by the absolutely-placed match
                  cards (see Slice 1 of the schedule overhaul plan). */}
              <div
                className="sticky top-0 z-20 bg-white border-b border-gray-300"
                style={{ gridColumn: 1, gridRow: 1 }}
              />
              {lices.map((lice, liceIndex) => (
                <div
                  key={lice.id}
                  className="sticky top-0 z-20 bg-white border-b border-gray-300 border-l border-l-gray-200 px-2 flex items-center"
                  style={{ gridColumn: liceIndex + 2, gridRow: 1, height: SLOT_HEIGHT_PX * 2 }}
                >
                  <span className="text-xs font-bold text-gray-700 truncate">{lice.name}</span>
                </div>
              ))}

              {/* Rows 2..TOTAL_SLOTS+1: time-label cell + one drop-target cell per lice.
                  Every cell is explicitly placed via gridColumn/gridRow so that
                  match cards (which are also explicitly placed below) can't
                  cascade auto-flow rightward. Dropping a fight at e.g. 09:10 in
                  lice 2 used to push the 10:00 label out of col 1 — see the
                  schedule overhaul plan, Slice 1. */}
              {Array.from({ length: TOTAL_SLOTS }, (_, slot) => (
                <Fragment key={slot}>
                  {/* Time label — sticky left, explicit (col 1, row slot+2) */}
                  <div
                    className="sticky left-0 z-10 bg-white text-xs text-gray-400 pr-1 flex items-center justify-end select-none"
                    style={{
                      gridColumn: 1,
                      gridRow: slot + 2,
                      borderTop: slot % 12 === 0 ? '1px solid #d1d5db' : '1px solid transparent',
                    }}
                  >
                    {slot % 12 === 0 ? formatSlotTime(slot) : ''}
                  </div>

                  {/* Drop-target cells — one per lice, explicit column index */}
                  {lices.map((lice, liceIndex) => (
                    <div
                      key={lice.id}
                      className="bg-gray-50 border-l border-l-gray-200"
                      style={{
                        gridColumn: liceIndex + 2,
                        gridRow: slot + 2,
                        borderTop: slot % 12 === 0 ? '1px solid #d1d5db' : '1px solid transparent',
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(lice.id, slot)}
                    />
                  ))}
                </Fragment>
              ))}

              {/* Scheduled match cards on the active day — positioned by grid cell. */}
              {scheduledOnActiveDay.map((m) => {
                const liceIndex = lices.findIndex((l) => l.id === m.liceId);
                if (liceIndex === -1) return null;
                const slot = isoToSlot(m.scheduledAt!, activeDay);
                const span = Math.max(1, Math.floor(m.durationMinutes / SLOT_MINUTES));
                const hasConflict = conflicts.some(
                  (c) => c.matchA === m.matchNumberLabel || c.matchB === m.matchNumberLabel,
                );
                const isBracket = m.phaseType !== null && m.phaseType !== 'pool';
                return (
                  <div
                    key={m.id}
                    draggable
                    onDragStart={() => {
                      dragMatch.current = m;
                    }}
                    className={[
                      'rounded text-xs font-medium px-1 flex items-center cursor-grab active:cursor-grabbing overflow-hidden z-10',
                      hasConflict
                        ? 'bg-red-200 border border-red-400 text-red-800'
                        : isBracket
                          ? 'bg-amber-100 border border-amber-300 text-amber-800'
                          : 'bg-blue-100 border border-blue-300 text-blue-800',
                      saving === m.id ? 'opacity-50' : '',
                    ].join(' ')}
                    style={{
                      gridColumn: liceIndex + 2, // +1 for time-label col, +1 for 1-based
                      gridRow: `${slot + 2} / span ${span}`, // +1 for header row, +1 for 1-based
                      margin: '1px',
                    }}
                    title={`${m.matchNumberLabel}${m.tournamentName ? ` · ${m.tournamentName}` : ''}: ${m.redFighterName ?? '?'} vs ${m.blueFighterName ?? '?'}`}
                  >
                    <span className="truncate">{m.matchNumberLabel}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchChip({
  match,
  saving,
  onDragStart,
}: {
  match: ScheduleMatch;
  saving: boolean;
  onDragStart: () => void;
}) {
  const isBracket = match.phaseType !== null && match.phaseType !== 'pool';
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={[
        'border rounded-lg px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing bg-white hover:border-gray-400 transition-colors',
        isBracket ? 'border-amber-300' : 'border-gray-300',
        saving ? 'opacity-50' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1">
        <p className="flex-1 font-medium text-gray-900 truncate">{match.matchNumberLabel}</p>
        {isBracket && (
          <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[10px] text-amber-800">
            Bracket
          </span>
        )}
      </div>
      <p className="text-gray-400 truncate">
        {match.redFighterName ?? '?'} vs {match.blueFighterName ?? '?'}
      </p>
    </div>
  );
}
