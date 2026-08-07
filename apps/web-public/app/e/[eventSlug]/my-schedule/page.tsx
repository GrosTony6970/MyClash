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
import { getPublicApiUrl } from '@/lib/api-url';
import { localeToBcp47, type AppLocale } from '@myclash/time';
import { sideColorsForTokens } from '@myclash/ui';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../src/i18n/I18nProvider';

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Each side's colour for this match, from the tournament's own config. This
 * page is a light surface, so a black/white side gets clamped to stay legible.
 */
function scoreColors(match: ScheduleMatch): { red: string; blue: string } {
  return sideColorsForTokens(match.sideColors, 'light');
}

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
  /** The tournament's configured side colours — per match, since a schedule
   *  can span tournaments with different palettes. */
  sideColors?: { red: string; blue: string } | null;
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

function formatTime(iso: string | null, t: TranslateFn, locale: AppLocale): string {
  if (!iso) return t('publicApp.mySchedule.tbd');
  return new Date(iso).toLocaleTimeString(localeToBcp47(locale), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDay(iso: string, locale: AppLocale): string {
  return new Date(iso).toLocaleDateString(localeToBcp47(locale), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function detectConflicts(items: ScheduleItem[], t: TranslateFn): Map<string, string[]> {
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
        const aLabel = itemLabel(a, t);
        const bLabel = itemLabel(b, t);

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

function itemLabel(item: ScheduleItem, t: TranslateFn): string {
  if (item.kind === 'match') return item.data.matchNumberLabel;
  if (item.kind === 'referee')
    return t('publicApp.mySchedule.refereeLabel', { match: item.data.matchNumberLabel });
  return item.data.workshopName;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MySchedulePage() {
  const { t, locale } = useI18n();
  const params = useParams<{ eventSlug: string }>();
  const { eventSlug } = params;
  const apiUrl = getPublicApiUrl();

  const [schedule, setSchedule] = useState<PersonSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [focusMode, setFocusMode] = useState(true);
  const [days, setDays] = useState<string[]>([]);
  // Guest sessions get a persistent banner: claim upgrade + end-session.
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/me`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (res.ok) {
          const me = (await res.json()) as { type?: string };
          setIsGuest(me.type === 'guest');
        }
      })
      .catch(() => undefined);
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
        <span className="w-8 h-8 border-2 border-muted border-t-transparent rounded-full animate-spin" />
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
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground mb-2">
            {t('publicApp.mySchedule.signInTitle')}
          </h1>
        </div>
      </main>
    );
  }

  // Build unified item list
  const allItems: ScheduleItem[] = [
    ...schedule.matches.map((m): ScheduleItem => ({
      kind: 'match',
      data: m,
      time: m.scheduledAt,
    })),
    ...schedule.refereeSlots.map((r): ScheduleItem => ({
      kind: 'referee',
      data: r,
      time: r.scheduledAt,
    })),
    ...(schedule.workshops ?? []).map((w): ScheduleItem => ({
      kind: 'workshop',
      data: w,
      time: w.sessionStart,
    })),
  ];

  // Day filter
  const filtered =
    dayFilter === 'all' ? allItems : allItems.filter((i) => i.time?.startsWith(dayFilter));

  // Sort by time
  const sorted = [...filtered].sort((a, b) => getTime(a) - getTime(b));

  // Conflict detection
  const conflicts = detectConflicts(sorted, t);

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
          className="font-display font-bold text-2xl sm:text-3xl"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent)' }}
        >
          {t('publicApp.mySchedule.title')}
        </h1>

        {/* Focus toggle */}
        <button
          onClick={() => setFocusMode((f) => !f)}
          aria-pressed={focusMode}
          className="text-xs border border-border rounded-lg px-3 py-1.5 text-foreground-secondary hover:border-muted transition-colors"
        >
          {focusMode ? t('publicApp.mySchedule.showAll') : t('publicApp.mySchedule.focusOnMe')}
        </button>
      </div>

      {/* Guest-session banner: this device follows the event without an
          account — offer the permanent upgrade (claim) + explicit logout
          (DELETE /guest-sessions/me, previously unreachable from any UI). */}
      {isGuest && (
        <div className="mb-4 rounded-xl border border-dashed border-border bg-background px-4 py-3 text-sm text-foreground-secondary">
          <p>{t('publicApp.mySchedule.guestBanner')}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link
              href={`/e/${eventSlug}/claim?personId=${schedule.personId}&next=${encodeURIComponent(`/e/${eventSlug}`)}`}
              className="font-semibold underline hover:no-underline"
            >
              {t('publicApp.mySchedule.guestClaimLink')}
            </Link>
            <button
              type="button"
              onClick={() => {
                void fetch(`${apiUrl}/api/v1/guest-sessions/me`, {
                  method: 'DELETE',
                  credentials: 'include',
                }).finally(() => window.location.assign(`/e/${eventSlug}/home`));
              }}
              className="text-muted underline hover:no-underline"
            >
              {t('publicApp.mySchedule.guestEndSession')}
            </button>
          </div>
        </div>
      )}

      {/* Day filter */}
      {days.length > 1 && (
        <div
          role="group"
          aria-label={t('publicApp.mySchedule.filterByDay')}
          className="flex gap-2 mb-4 overflow-x-auto pb-1"
        >
          <button
            onClick={() => setDayFilter('all')}
            aria-pressed={dayFilter === 'all'}
            className={[
              'flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
              dayFilter === 'all'
                ? 'text-white border-transparent'
                : 'text-foreground-secondary border-border',
            ].join(' ')}
            style={dayFilter === 'all' ? { backgroundColor: 'var(--color-accent)' } : {}}
          >
            {t('publicApp.mySchedule.allDays')}
          </button>
          {days.map((day) => (
            <button
              key={day}
              onClick={() => setDayFilter(day)}
              aria-pressed={dayFilter === day}
              className={[
                'flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                dayFilter === day
                  ? 'text-white border-transparent'
                  : 'text-foreground-secondary border-border',
              ].join(' ')}
              style={dayFilter === day ? { backgroundColor: 'var(--color-accent)' } : {}}
            >
              {new Date(day).toLocaleDateString(localeToBcp47(locale), {
                weekday: 'short',
                day: 'numeric',
              })}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-12">
          <p className="text-4xl mb-3">📅</p>
          <p className="text-muted text-sm">
            {dayFilter !== 'all'
              ? t('publicApp.mySchedule.emptyDay')
              : t('publicApp.mySchedule.emptyAll')}
          </p>
        </div>
      )}

      {/* Schedule items grouped by day */}
      {Array.from(byDay.entries()).map(([day, items]) => (
        <section key={day} className="mb-6">
          {day !== 'unscheduled' && (
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
              {formatDay(day, locale)}
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
                      ? 'border-danger/40 bg-danger/10'
                      : item.kind === 'match'
                        ? 'border-border bg-surface'
                        : item.kind === 'referee'
                          ? 'border-info/30 bg-info/10'
                          : 'border-warning/30 bg-warning/10',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      {/* Time */}
                      <p className="text-xs text-muted mb-0.5">
                        {formatTime(item.time, t, locale)}
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
                          <p className="font-semibold text-foreground">
                            {item.data.matchNumberLabel}
                          </p>
                          <p className="text-muted text-xs mt-0.5">
                            {t('publicApp.mySchedule.vs')}{' '}
                            {item.data.opponentName ?? t('publicApp.mySchedule.tbd')}
                            {item.data.tournamentName && ` · ${item.data.tournamentName}`}
                          </p>
                          {item.data.status === 'completed' && (
                            <p className="text-xs font-mono mt-0.5">
                              <span style={{ color: scoreColors(item.data).red }}>
                                {item.data.redScore}
                              </span>
                              <span className="text-muted mx-1">–</span>
                              <span style={{ color: scoreColors(item.data).blue }}>
                                {item.data.blueScore}
                              </span>
                            </p>
                          )}
                        </>
                      )}

                      {item.kind === 'referee' && (
                        <>
                          <p className="font-semibold text-info">
                            {t('publicApp.mySchedule.refereePrefix')} — {item.data.matchNumberLabel}
                          </p>
                          <p className="text-info text-xs mt-0.5">
                            {item.data.role.replace(/_/g, ' ')}
                            {item.data.tournamentName && ` · ${item.data.tournamentName}`}
                          </p>
                        </>
                      )}

                      {item.kind === 'workshop' && (
                        <>
                          <p className="font-semibold text-warning">{item.data.workshopName}</p>
                          {item.data.location && (
                            <p className="text-warning text-xs mt-0.5">📍 {item.data.location}</p>
                          )}
                        </>
                      )}

                      {/* Conflict warning */}
                      {hasConflict && (
                        <p className="text-xs text-danger mt-1 font-medium">
                          {t('publicApp.mySchedule.conflictsWith', {
                            items: itemConflicts.join(', '),
                          })}
                        </p>
                      )}
                    </div>

                    {/* Status badge */}
                    {item.kind === 'match' && item.data.status === 'running' && (
                      <span className="flex items-center gap-1 text-xs font-bold text-danger flex-shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                        {t('publicApp.mySchedule.live')}
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
