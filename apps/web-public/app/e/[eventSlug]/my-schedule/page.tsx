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

import { useEffect, useState, type ReactNode } from 'react';
import { fetchMe } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { boutPageHref } from '@/lib/bout-page';
import { BackLink } from '@/components/BackLink';
import { NotFoundCard } from '@/components/NotFoundCard';
import { ClashCheckNotice } from '@/components/me/ClashCheckNotice';
import {
  detectConflicts,
  dutyTimed,
  fightItems,
  spreadPoolConflicts,
  toTimed,
  uncheckedCount,
  type TimedItem,
} from '@/components/me/conflicts';
import type {
  PersonSchedule,
  PoolSpan,
  RefereeSlot,
  ScheduleMatch,
  WorkshopEnrollment,
} from '@/components/me/types';
import { DEFAULT_EVENT_TIMEZONE, formatInZone, localeToBcp47, type AppLocale } from '@myclash/time';
import { isLiveStatus } from '@myclash/types';
import { sideColorsForTokens } from '@myclash/ui';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '@myclash/next-i18n/client';
import { dayChipLabel, dayHeading, eventDay, eventDays, onEventDay } from './schedule-days';
import { ScheduleNotShown, type NotShownReason } from './ScheduleNotShown';
import { forgetSchedules } from '@/components/me/schedule-copy';
import { ScheduleUpdatedBadge } from '@/components/me/ScheduleUpdatedBadge';
import { useMySchedule } from '@/components/me/use-my-schedule';
import { unknownCaller, type UnknownCaller } from '@/components/me/workshop-booking';
import { refereeRoleLabel } from '@/components/me/referee-role';

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Each side's colour for this match, from the tournament's own config. This
 * page is a light surface, so a black/white side gets clamped to stay legible.
 */
function scoreColors(match: ScheduleMatch): { red: string; blue: string } {
  return sideColorsForTokens(match.sideColors, 'light');
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ScheduleItem =
  | { kind: 'match'; data: ScheduleMatch; time: string | null }
  | { kind: 'referee'; data: RefereeSlot; time: string | null }
  | { kind: 'workshop'; data: WorkshopEnrollment; time: string | null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTime(item: ScheduleItem): number {
  const t = item.time;
  return t ? new Date(t).getTime() : Infinity;
}

/** A time on the EVENT's clock: the phone of a fighter who travelled may be on another. */
function formatTime(iso: string | null, tz: string, t: TranslateFn, locale: AppLocale): string {
  if (!iso) return t('publicApp.mySchedule.tbd');
  return formatInZone(iso, tz, { hour: '2-digit', minute: '2-digit' }, localeToBcp47(locale));
}

/** A duty or a workshop — the items that are not bouts. */
type OtherItem = Exclude<ScheduleItem, { kind: 'match' }>;

const matchKey = (match: ScheduleMatch): string => `match-${match.id}`;

/**
 * Every commitment on the page as a timed item: the bouts AND their Pools (a
 * fighter is busy for the whole Pool), the duties, the workshops. An item whose
 * end is unknown takes no part: a bout ends at its planned length, or at the
 * API's fallback end when it has none, and a duty at the end the API works out. This page used to call two starts less than five
 * minutes apart a clash, which flagged back-to-back bouts and missed a Workshop
 * running over a bout an hour into it. In time order, so each card lists what it
 * clashes with in the order the day runs.
 */
function timedItems(
  matches: ScheduleMatch[],
  others: OtherItem[],
  poolSpans: PoolSpan[],
  t: TranslateFn,
): TimedItem[] {
  return [
    ...fightItems({ matches, poolSpans }, matchKey, (m) => m.matchNumberLabel),
    ...others.flatMap((item) => {
      const key = itemKey(item);
      const label = itemLabel(item, t);
      const timed =
        item.kind === 'referee'
          ? dutyTimed(key, label, item.data)
          : toTimed(key, label, item.data.sessionStart, item.data.sessionEnd);
      return timed ? [timed] : [];
    }),
  ].sort((a, b) => a.startMs - b.startMs);
}

/** What a duty is called: its Match's label, or its Pool's name for a whole-Pool duty. */
function dutyName(slot: RefereeSlot): string {
  return slot.matchNumberLabel || (slot.poolName ?? '');
}

function itemKey(item: ScheduleItem): string {
  if (item.kind === 'match') return matchKey(item.data);
  if (item.kind === 'referee') return `ref-${item.data.id}`;
  return `ws-${item.data.workshopId}`;
}

/** The page's cards, as the clash check counts the ones it cannot see. */
const cardsOf = (items: ScheduleItem[]) =>
  items.map((item) => ({ key: itemKey(item), time: item.time }));

function itemLabel(item: OtherItem, t: TranslateFn): string {
  if (item.kind === 'referee')
    return t('publicApp.mySchedule.refereeLabel', { match: dutyName(item.data) });
  return item.data.workshopName;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MySchedulePage() {
  const { t, locale } = useI18n();
  const params = useParams<{ eventSlug: string }>();
  const { eventSlug } = params;
  const apiUrl = getPublicApiUrl();

  // The schedule, the phone's copy of it, or why there is none: ONE reader (`useMySchedule`).
  const mine = useMySchedule<PersonSchedule>(eventSlug);
  // The server knows nobody here: a visitor, or an account with no row at this
  // Event, for which "sign in" would be false. Asked once it has said so.
  const [unknown, setUnknown] = useState<UnknownCaller | null>(null);
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [focusMode, setFocusMode] = useState(true);
  // Guest sessions get a persistent banner: claim upgrade + end-session.
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMe(apiUrl, { signal: controller.signal }).then((result) => {
      if (result.ok) setIsGuest(result.data.type === 'guest');
    });
    return () => controller.abort();
  }, [apiUrl]);

  const signedOut = mine.state === 'signedOut';
  useEffect(() => {
    if (!signedOut) return;
    let left = false;
    void unknownCaller(apiUrl).then((who) => {
      if (!left) setUnknown(who);
    });
    return () => {
      left = true;
    };
  }, [signedOut, apiUrl]);

  const reason: NotShownReason | null = signedOut
    ? unknown
    : mine.state === 'failed'
      ? 'failed'
      : null;
  if (reason) {
    return <ScheduleNotShown reason={reason} eventSlug={eventSlug} onRetry={mine.retry} />;
  }
  // A draft or test Event hidden from this visitor, as its other pages are (ruling 2026-10-16).
  // The read already renewed a lapsed login, so the card has none to renew.
  if (mine.state === 'notFound') return <NotFoundCard renewLogin={false} />;
  const schedule = mine.schedule;
  if (!schedule) {
    return (
      <main id="main-content" className="flex min-h-screen items-center justify-center">
        <span className="w-8 h-8 border-2 border-muted border-t-transparent rounded-full animate-spin" />
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
      time: r.scheduledAt ?? r.startsAt,
    })),
    ...(schedule.workshops ?? []).map((w): ScheduleItem => ({
      kind: 'workshop',
      data: w,
      time: w.sessionStart,
    })),
  ];

  // The chips, the filter and the headings below read a day one way: `schedule-days.ts`.
  const tz = schedule.timezone ?? DEFAULT_EVENT_TIMEZONE;
  const days = eventDays(allItems, tz);
  const filtered = onEventDay(allItems, dayFilter, tz);

  // Sort by time
  const sorted = [...filtered].sort((a, b) => getTime(a) - getTime(b));

  // Conflict detection: overlapping windows, among the items whose end is known.
  // A Pool's clashes show on every bout of that Pool.
  const shownMatches = sorted.flatMap((item) => (item.kind === 'match' ? [item.data] : []));
  const others = sorted.filter((item): item is OtherItem => item.kind !== 'match');
  // A copy the phone kept before the API sent Pools has none: no Pool clash to show.
  const timed = timedItems(shownMatches, others, schedule.poolSpans ?? [], t);
  const conflicts = spreadPoolConflicts(
    detectConflicts(timed),
    { matches: shownMatches },
    matchKey,
  );

  // Group by day, on the EVENT's clock.
  const byDay = new Map<string, ScheduleItem[]>();
  for (const item of sorted) {
    const day = item.time ? eventDay(item.time, tz) : 'unscheduled';
    const arr = byDay.get(day) ?? [];
    arr.push(item);
    byDay.set(day, arr);
  }

  const isEmpty = sorted.length === 0;

  return (
    <main id="main-content" className="px-4 py-6 max-w-lg mx-auto">
      <BackLink
        href={`/e/${eventSlug}/home`}
        label={t('publicApp.eventHome.backToHome')}
        className="mb-4"
      />
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

      <ClashCheckNotice count={uncheckedCount(cardsOf(sorted), timed)} />

      {mine.updatedAt != null && (
        <ScheduleUpdatedBadge updatedAt={mine.updatedAt} offline={mine.offline} tz={tz} />
      )}

      {/* The pass hangs off this page rather than /me because /me is
          claimed-only, and most participants at a real event are guests. This
          page already serves both identities, so it is the one door both can
          reach. */}
      <Link
        href={`/e/${eventSlug}/pass`}
        className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-foreground hover:border-muted transition-colors"
      >
        <span>{t('publicApp.pass.link')}</span>
        <span aria-hidden="true">›</span>
      </Link>

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
                }).finally(() => {
                  // "This is not me": her schedule leaves the phone with her.
                  forgetSchedules();
                  window.location.assign(`/e/${eventSlug}/home`);
                });
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
              {dayChipLabel(day, locale)}
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
              {dayHeading(day, locale)}
            </h2>
          )}
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const key = itemKey(item);
              const itemConflicts = conflicts.get(key) ?? [];
              const hasConflict = itemConflicts.length > 0;

              return (
                <ScheduleCard
                  key={key}
                  href={
                    item.kind === 'match'
                      ? boutPageHref(eventSlug, item.data.id, `/e/${eventSlug}/my-schedule`)
                      : undefined
                  }
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
                        {formatTime(item.time, tz, t, locale)}
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
                            {t('publicApp.mySchedule.refereePrefix')} — {dutyName(item.data)}
                          </p>
                          <p className="text-info text-xs mt-0.5">
                            {refereeRoleLabel(item.data.skillName, t)}
                            {item.data.tournamentName && ` · ${item.data.tournamentName}`}
                          </p>
                        </>
                      )}

                      {item.kind === 'workshop' && <WorkshopLines workshop={item.data} />}

                      {/* Conflict warning */}
                      {hasConflict && (
                        <p className="text-xs text-danger mt-1 font-medium">
                          {t('publicApp.mySchedule.conflictsWith', {
                            items: itemConflicts.join(', '),
                          })}
                        </p>
                      )}
                    </div>

                    {/* Status badge: a halted bout is still on the piste (`isLiveStatus`), as the hub says */}
                    {item.kind === 'match' &&
                      isLiveStatus(item.data.status) &&
                      (item.data.status === 'paused' ? (
                        <span className="flex-shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-bold text-muted">
                          {t('publicApp.live.paused')}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-bold text-danger flex-shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                          {t('publicApp.mySchedule.live')}
                        </span>
                      ))}
                  </div>
                </ScheduleCard>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}

/**
 * A card of the schedule. A bout's card is a link to the bout's page, where its
 * score and its hits are. A duty and a Workshop have no page to open from here:
 * a duty over a whole Pool names no bout.
 */
function ScheduleCard({
  href,
  className,
  children,
}: {
  href?: string;
  className: string;
  children: ReactNode;
}) {
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={`${className} block transition-colors hover:border-muted`}>
      {children}
    </Link>
  );
}

/** A Workshop of the schedule: its name, its waitlist mark (ruling 235), its place. */
function WorkshopLines({ workshop }: { workshop: WorkshopEnrollment }) {
  const { t } = useI18n();
  return (
    <>
      <p className="font-semibold text-warning">{workshop.workshopName}</p>
      {workshop.status === 'waitlisted' && (
        <p className="text-warning text-xs mt-0.5">{t('publicApp.me.workshops.onWaitlist')}</p>
      )}
      {workshop.location && <p className="text-warning text-xs mt-0.5">📍 {workshop.location}</p>}
    </>
  );
}
