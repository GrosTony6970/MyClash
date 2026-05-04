'use client';

/**
 * My Schedule — T-805
 * Route: /e/[eventSlug]/my-schedule
 *
 * AC:
 *   ✓ Day filter (Sat/Sun)
 *   ✓ Conflicts visually flagged (red border, "Conflicts with X")
 *   ✓ Referee role shown on referee items
 *   ✓ "Focus on me" vs "Show all" toggle
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduleMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  opponentName: string | null;
  redScore: number;
  blueScore: number;
  isRed: boolean;
  poolName: string | null;
  tournamentName: string | null;
  liceName: string | null;
}

interface RefereeSlot {
  matchId: string;
  matchNumberLabel: string;
  scheduledAt: string | null;
  role: string;
  poolName: string | null;
  tournamentName: string | null;
}

interface WorkshopEnrollment {
  workshopId: string;
  workshopName: string;
  sessionStart: string | null;
  sessionEnd: string | null;
  location: string | null;
}

interface PersonSchedule {
  personId: string;
  matches: ScheduleMatch[];
  refereeSlots: RefereeSlot[];
  workshops: WorkshopEnrollment[] | null;
}

type ScheduleItem =
  | { kind: 'match'; data: ScheduleMatch; time: string | null }
  | { kind: 'referee'; data: RefereeSlot; time: string | null }
  | { kind: 'workshop'; data: WorkshopEnrollment; time: string | null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTime(item: ScheduleItem): number {
  const t = item.time;
  return t ? new Date(t).getTime() : Infinity;
}

function formatTime(iso: string | null): string {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function detectConflicts(items: ScheduleItem[]): Map<string, string[]> {
  const conflicts = new Map<string, string[]>();
  const timed = items.filter((i) => i.time);

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;

      const aStart = new Date(a.time!).getTime();
      const bStart = new Date(b.time!).getTime();
      const duration = 5 * 60_000; // 5 min default

      if (Math.abs(aStart - bStart) < duration) {
        const aKey = itemKey(a);
        const bKey = itemKey(b);
        const aLabel = itemLabel(a);
        const bLabel = itemLabel(b);

        conflicts.set(aKey, [...(conflicts.get(aKey) ?? []), bLabel]);
        conflicts.set(bKey, [...(conflicts.get(bKey) ?? []), aLabel]);
      }
    }
  }
  return conflicts;
}

function itemKey(item: ScheduleItem): string {
  if (item.kind === 'match') return `match-${item.data.id}`;
  if (item.kind === 'referee') return `ref-${item.data.matchId}`;
  return `ws-${item.data.workshopId}`;
}

function itemLabel(item: ScheduleItem): string {
  if (item.kind === 'match') return item.data.matchNumberLabel;
  if (item.kind === 'referee') return `Referee: ${item.data.matchNumberLabel}`;
  return item.data.workshopName;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MySchedulePage() {
  const params = useParams<{ eventSlug: string }>();
  const { eventSlug } = params;
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [schedule, setSchedule] = useState<PersonSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [focusMode, setFocusMode] = useState(true);
  const [days, setDays] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/events/${eventSlug}/my-schedule`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        setLoading(false);
        if (res.ok) {
          const data = (await res.json()) as PersonSchedule;
          setSchedule(data);

          // Collect unique days
          const allTimes = [
            ...data.matches.map((m) => m.scheduledAt),
            ...data.refereeSlots.map((r) => r.scheduledAt),
            ...(data.workshops ?? []).map((w) => w.sessionStart),
          ]
            .filter(Boolean)
            .map((t) => t!.slice(0, 10));
          setDays([...new Set(allTimes)].sort());
        }
      })
      .catch((err: unknown) => {
        setLoading(false);
        if (err instanceof Error && err.name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [eventSlug, apiUrl]);

  if (loading) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!schedule) {
    return (
      <main
        id="main-content"
        className="flex min-h-screen items-center justify-center px-4 text-center"
      >
        <div>
          <p className="text-4xl mb-3">📅</p>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Sign in to see your schedule</h1>
          <Link
            href={`/e/${eventSlug}/onboarding`}
            className="text-sm underline"
            style={{ color: 'var(--event-primary, #c0392b)' }}
          >
            Find yourself in the participant list →
          </Link>
        </div>
      </main>
    );
  }

  // Build unified item list
  const allItems: ScheduleItem[] = [
    ...schedule.matches.map(
      (m): ScheduleItem => ({
        kind: 'match',
        data: m,
        time: m.scheduledAt,
      }),
    ),
    ...schedule.refereeSlots.map(
      (r): ScheduleItem => ({
        kind: 'referee',
        data: r,
        time: r.scheduledAt,
      }),
    ),
    ...(schedule.workshops ?? []).map(
      (w): ScheduleItem => ({
        kind: 'workshop',
        data: w,
        time: w.sessionStart,
      }),
    ),
  ];

  // Day filter
  const filtered =
    dayFilter === 'all' ? allItems : allItems.filter((i) => i.time?.startsWith(dayFilter));

  // Sort by time
  const sorted = [...filtered].sort((a, b) => getTime(a) - getTime(b));

  // Conflict detection
  const conflicts = detectConflicts(sorted);

  // Group by day
  const byDay = new Map<string, ScheduleItem[]>();
  for (const item of sorted) {
    const day = item.time?.slice(0, 10) ?? 'unscheduled';
    const arr = byDay.get(day) ?? [];
    arr.push(item);
    byDay.set(day, arr);
  }

  const isEmpty = sorted.length === 0;

  return (
    <main id="main-content" className="px-4 py-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--event-primary, #c0392b)' }}
        >
          My Schedule
        </h1>

        {/* Focus toggle */}
        <button
          onClick={() => setFocusMode((f) => !f)}
          className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:border-gray-400 transition-colors"
        >
          {focusMode ? 'Show all' : 'Focus on me'}
        </button>
      </div>

      {/* Day filter */}
      {days.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => setDayFilter('all')}
            className={[
              'flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
              dayFilter === 'all'
                ? 'text-white border-transparent'
                : 'text-gray-600 border-gray-300',
            ].join(' ')}
            style={dayFilter === 'all' ? { backgroundColor: 'var(--event-primary, #c0392b)' } : {}}
          >
            All days
          </button>
          {days.map((day) => (
            <button
              key={day}
              onClick={() => setDayFilter(day)}
              className={[
                'flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                dayFilter === day
                  ? 'text-white border-transparent'
                  : 'text-gray-600 border-gray-300',
              ].join(' ')}
              style={dayFilter === day ? { backgroundColor: 'var(--event-primary, #c0392b)' } : {}}
            >
              {new Date(day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">📅</p>
          <p className="text-gray-400 text-sm">
            {dayFilter !== 'all'
              ? 'Nothing scheduled on this day.'
              : 'Your schedule is empty. Check back once the organizer publishes the schedule.'}
          </p>
        </div>
      )}

      {/* Schedule items grouped by day */}
      {Array.from(byDay.entries()).map(([day, items]) => (
        <section key={day} className="mb-6">
          {day !== 'unscheduled' && (
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
              {formatDay(day)}
            </h2>
          )}
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const key = itemKey(item);
              const itemConflicts = conflicts.get(key) ?? [];
              const hasConflict = itemConflicts.length > 0;

              return (
                <div
                  key={key}
                  className={[
                    'border-2 rounded-xl px-4 py-3 text-sm',
                    hasConflict
                      ? 'border-red-400 bg-red-50'
                      : item.kind === 'match'
                        ? 'border-gray-200 bg-white'
                        : item.kind === 'referee'
                          ? 'border-blue-200 bg-blue-50'
                          : 'border-amber-200 bg-amber-50',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      {/* Time */}
                      <p className="text-xs text-gray-400 mb-0.5">
                        {formatTime(item.time)}
                        {item.kind === 'match' && item.data.liceName && (
                          <span className="ml-1">· {item.data.liceName}</span>
                        )}
                        {item.kind === 'referee' && item.data.poolName && (
                          <span className="ml-1">· {item.data.poolName}</span>
                        )}
                      </p>

                      {/* Content */}
                      {item.kind === 'match' && (
                        <>
                          <p className="font-semibold text-gray-900">
                            {item.data.matchNumberLabel}
                          </p>
                          <p className="text-gray-500 text-xs mt-0.5">
                            vs {item.data.opponentName ?? 'TBD'}
                            {item.data.tournamentName && ` · ${item.data.tournamentName}`}
                          </p>
                          {item.data.status === 'completed' && (
                            <p className="text-xs font-mono mt-0.5">
                              <span className="text-red-500">{item.data.redScore}</span>
                              <span className="text-gray-400 mx-1">–</span>
                              <span className="text-blue-500">{item.data.blueScore}</span>
                            </p>
                          )}
                        </>
                      )}

                      {item.kind === 'referee' && (
                        <>
                          <p className="font-semibold text-blue-800">
                            Referee — {item.data.matchNumberLabel}
                          </p>
                          <p className="text-blue-600 text-xs mt-0.5">
                            {item.data.role.replace(/_/g, ' ')}
                            {item.data.tournamentName && ` · ${item.data.tournamentName}`}
                          </p>
                        </>
                      )}

                      {item.kind === 'workshop' && (
                        <>
                          <p className="font-semibold text-amber-800">{item.data.workshopName}</p>
                          {item.data.location && (
                            <p className="text-amber-600 text-xs mt-0.5">📍 {item.data.location}</p>
                          )}
                        </>
                      )}

                      {/* Conflict warning */}
                      {hasConflict && (
                        <p className="text-xs text-red-600 mt-1 font-medium">
                          ⚠ Conflicts with: {itemConflicts.join(', ')}
                        </p>
                      )}
                    </div>

                    {/* Status badge */}
                    {item.kind === 'match' && item.data.status === 'running' && (
                      <span className="flex items-center gap-1 text-xs font-bold text-red-500 flex-shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        LIVE
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
