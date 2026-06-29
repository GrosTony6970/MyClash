'use client';

import { formatInZone } from '@myclash/time';
import { EmptyState } from '@myclash/ui';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { CommitmentCard } from './CommitmentCard';
import { detectConflicts, toTimed, type TimedItem } from './conflicts';
import type { PersonSchedule, RefereeSlot, ScheduleMatch } from './types';

const DEFAULT_TZ = 'Europe/Paris';

type DisplayItem =
  | { kind: 'fight'; key: string; time: string | null; data: ScheduleMatch }
  | { kind: 'referee'; key: string; time: string | null; data: RefereeSlot };

function localeTag(locale: string): string {
  return locale === 'fr' ? 'fr-FR' : 'en-GB';
}

export function ScheduleView({
  schedule,
  timezone,
  eventSlug,
  /** When set, render the "Updated HH:MM (· offline)" stale badge. */
  updatedAt,
  offline = false,
}: {
  schedule: PersonSchedule;
  timezone: string | null;
  eventSlug?: string;
  updatedAt?: number | null;
  offline?: boolean;
}): ReactNode {
  const { t, locale } = useI18n();
  const tz = timezone ?? DEFAULT_TZ;
  const tag = localeTag(locale);

  const fmtTime = (iso: string | null) =>
    iso
      ? formatInZone(iso, tz, { hour: '2-digit', minute: '2-digit' }, tag)
      : t('publicApp.me.schedule.tbd');
  const fmtDay = (iso: string) =>
    formatInZone(iso, tz, { weekday: 'long', day: 'numeric', month: 'long' }, tag);

  // Conflict detection spans matches + referee slots + workshops (bidirectional)
  // so a fight/referee card flags an overlapping workshop the user joined.
  const timed: TimedItem[] = [
    ...schedule.matches.flatMap((m) => {
      const ti = toTimed(`fight-${m.id}`, m.opponentName ?? m.matchNumberLabel, m.scheduledAt);
      return ti ? [ti] : [];
    }),
    ...schedule.refereeSlots.flatMap((r) => {
      const ti = toTimed(
        `ref-${r.matchId}`,
        `${t('publicApp.me.schedule.referee')} · ${r.matchNumberLabel}`,
        r.scheduledAt,
      );
      return ti ? [ti] : [];
    }),
    ...(schedule.workshops ?? []).flatMap((w) => {
      const ti = toTimed(`ws-${w.workshopId}`, w.workshopName, w.sessionStart, w.sessionEnd);
      return ti ? [ti] : [];
    }),
  ];
  const conflicts = detectConflicts(timed);

  const items: DisplayItem[] = [
    ...schedule.matches.map(
      (m): DisplayItem => ({ kind: 'fight', key: `fight-${m.id}`, time: m.scheduledAt, data: m }),
    ),
    ...schedule.refereeSlots.map(
      (r): DisplayItem => ({
        kind: 'referee',
        key: `ref-${r.matchId}`,
        time: r.scheduledAt,
        data: r,
      }),
    ),
  ].sort(
    (a, b) =>
      (a.time ? new Date(a.time).getTime() : Infinity) -
      (b.time ? new Date(b.time).getTime() : Infinity),
  );

  // "Next" = the first not-yet-completed commitment in chronological order.
  const nextKey = items.find((i) =>
    i.kind === 'fight' ? i.data.status !== 'completed' : true,
  )?.key;

  if (items.length === 0) {
    return <EmptyState title={t('publicApp.me.schedule.emptyAll')} />;
  }

  // Group by calendar day (event-local).
  const byDay = new Map<string, DisplayItem[]>();
  for (const item of items) {
    const day = item.time
      ? formatInZone(item.time, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, tag)
      : 'unscheduled';
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }

  function statusFor(m: ScheduleMatch) {
    if (m.status === 'running')
      return { label: t('publicApp.me.schedule.live'), tone: 'live' as const };
    if (m.status === 'completed') {
      const my = m.isRed ? m.redScore : m.blueScore;
      const opp = m.isRed ? m.blueScore : m.redScore;
      const key = my >= opp ? 'won' : 'lost';
      return {
        label: t(`publicApp.me.schedule.${key}`, { red: String(my), blue: String(opp) }),
        tone: 'done' as const,
      };
    }
    return { label: t('publicApp.me.schedule.upcoming'), tone: 'pending' as const };
  }

  return (
    <div>
      {updatedAt != null && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold text-muted">
          <span
            className={['h-1.5 w-1.5 rounded-full', offline ? 'bg-warning' : 'bg-success'].join(
              ' ',
            )}
          />
          {t(offline ? 'publicApp.me.schedule.offlineUpdated' : 'publicApp.me.schedule.updated', {
            time: formatInZone(
              new Date(updatedAt).toISOString(),
              tz,
              { hour: '2-digit', minute: '2-digit' },
              tag,
            ),
          })}
        </div>
      )}

      {[...byDay.entries()].map(([day, dayItems]) => (
        <section key={day} className="mb-5">
          {day !== 'unscheduled' && (
            <h2 className="mb-2.5 mt-1 text-[11px] font-extrabold uppercase tracking-wider text-muted">
              {fmtDay(dayItems.find((i) => i.time)?.time ?? day)}
            </h2>
          )}
          <div className="flex flex-col gap-2">
            {dayItems.map((item) => {
              const conflict = conflicts.get(item.key);
              const conflictLabel = conflict?.length
                ? t('publicApp.me.schedule.conflictsWith', { items: conflict.join(', ') })
                : null;
              if (item.kind === 'fight') {
                const m = item.data;
                return (
                  <CommitmentCard
                    key={item.key}
                    kind="fight"
                    timeLabel={fmtTime(m.scheduledAt)}
                    place={m.liceName}
                    title={`${t('publicApp.me.schedule.vs')} ${m.opponentName ?? t('publicApp.me.schedule.tbd')}`}
                    meta={[m.poolName, m.tournamentName].filter(Boolean).join(' · ') || null}
                    status={statusFor(m)}
                    conflict={conflictLabel}
                    isNext={item.key === nextKey}
                    nextLabel={t('publicApp.me.schedule.next')}
                    side={m.isRed ? 'red' : 'blue'}
                    href={eventSlug ? `/e/${eventSlug}/match/${m.id}` : undefined}
                  />
                );
              }
              const r = item.data;
              return (
                <CommitmentCard
                  key={item.key}
                  kind="referee"
                  timeLabel={fmtTime(r.scheduledAt)}
                  place={r.poolName}
                  title={`${t('publicApp.me.schedule.referee')} · ${r.matchNumberLabel}`}
                  meta={
                    [r.role.replace(/_/g, ' '), r.tournamentName].filter(Boolean).join(' · ') ||
                    null
                  }
                  conflict={conflictLabel}
                  isNext={item.key === nextKey}
                  nextLabel={t('publicApp.me.schedule.next')}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
