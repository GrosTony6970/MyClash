'use client';

import { formatInZone } from '@myclash/time';
import { EmptyState, SkillBadge } from '@myclash/ui';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { CommitmentCard } from './CommitmentCard';
import { detectConflicts, toTimed, type TimedItem } from './conflicts';
import type { PersonSchedule, RefereeSlot, ScheduleMatch, WorkshopEnrollment } from './types';

const DEFAULT_TZ = 'Europe/Paris';

type DisplayItem =
  | { kind: 'fight'; key: string; time: string | null; data: ScheduleMatch }
  | { kind: 'referee'; key: string; time: string | null; data: RefereeSlot }
  | { kind: 'workshop'; key: string; time: string | null; data: WorkshopEnrollment };

/** A sub-group of same-tournament fights / same-assignment referee slots /
 *  enrolled workshops, rendered under one title + a connecting thread. */
interface Group {
  key: string;
  kind: 'fight' | 'referee' | 'workshop';
  title: string;
  skillName?: string | null;
  skillColor?: string | null;
  items: DisplayItem[];
  firstTime: number;
}

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
    ...(schedule.workshops ?? []).map(
      (w): DisplayItem => ({
        kind: 'workshop',
        key: `ws-${w.workshopId}`,
        time: w.sessionStart,
        data: w,
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

  // Group by calendar day (event-local), then by tournament / referee
  // assignment / workshops within each day.
  const byDay = new Map<string, DisplayItem[]>();
  for (const item of items) {
    const day = item.time
      ? formatInZone(item.time, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, tag)
      : 'unscheduled';
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }

  function groupKeyOf(item: DisplayItem): string {
    if (item.kind === 'fight') return `f:${item.data.tournamentName ?? ''}`;
    if (item.kind === 'referee')
      return `r:${item.data.tournamentName ?? ''}:${item.data.poolName ?? ''}`;
    return 'w';
  }

  function groupTitle(item: DisplayItem): string {
    if (item.kind === 'fight') return item.data.tournamentName ?? t('publicApp.me.hub.competing');
    if (item.kind === 'referee')
      return t('publicApp.me.schedule.refereeingGroup', {
        tournament: item.data.tournamentName ?? '',
      });
    return t('publicApp.me.hub.tabWorkshops');
  }

  function groupsForDay(dayItems: DisplayItem[]): Group[] {
    const map = new Map<string, Group>();
    for (const item of dayItems) {
      const key = groupKeyOf(item);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          kind: item.kind,
          title: groupTitle(item),
          skillName: item.kind === 'referee' ? item.data.skillName : null,
          skillColor: item.kind === 'referee' ? item.data.skillColor : null,
          items: [],
          firstTime: item.time ? new Date(item.time).getTime() : Infinity,
        };
        map.set(key, g);
      }
      g.items.push(item);
    }
    return [...map.values()].sort((a, b) => a.firstTime - b.firstTime);
  }

  function statusFor(m: ScheduleMatch) {
    if (m.status === 'running')
      return { label: t('publicApp.me.schedule.live'), tone: 'live' as const };
    if (m.status === 'completed') {
      const my = m.isRed ? m.redScore : m.blueScore;
      const opp = m.isRed ? m.blueScore : m.redScore;
      const vals = { red: String(my), blue: String(opp) };
      if (my > opp) return { label: t('publicApp.me.schedule.won', vals), tone: 'done' as const };
      if (my < opp) return { label: t('publicApp.me.schedule.lost', vals), tone: 'lost' as const };
      return { label: t('publicApp.me.schedule.draw', vals), tone: 'draw' as const };
    }
    return { label: t('publicApp.me.schedule.upcoming'), tone: 'pending' as const };
  }

  function renderCard(item: DisplayItem): ReactNode {
    const conflict = conflicts.get(item.key);
    const conflictLabel = conflict?.length
      ? t('publicApp.me.schedule.conflictsWith', { items: conflict.join(', ') })
      : null;
    if (item.kind === 'fight') {
      const m = item.data;
      return (
        <CommitmentCard
          kind="fight"
          timeLabel={fmtTime(m.scheduledAt)}
          place={m.liceName}
          title={`${t('publicApp.me.schedule.vs')} ${m.opponentName ?? t('publicApp.me.schedule.tbd')}`}
          meta={m.poolName}
          status={statusFor(m)}
          conflict={conflictLabel}
          isNext={item.key === nextKey}
          nextLabel={t('publicApp.me.schedule.next')}
          side={m.isRed ? 'red' : 'blue'}
          href={eventSlug ? `/e/${eventSlug}/match/${m.id}` : undefined}
        />
      );
    }
    if (item.kind === 'referee') {
      const r = item.data;
      return (
        <CommitmentCard
          kind="referee"
          timeLabel={fmtTime(r.scheduledAt)}
          place={r.poolName}
          title={`${t('publicApp.me.schedule.referee')} · ${r.matchNumberLabel}`}
          meta={null}
          conflict={conflictLabel}
          isNext={item.key === nextKey}
          nextLabel={t('publicApp.me.schedule.next')}
        />
      );
    }
    const w = item.data;
    return (
      <CommitmentCard
        kind="workshop"
        timeLabel={fmtTime(w.sessionStart)}
        place={w.location}
        title={w.workshopName}
        meta={null}
        conflict={conflictLabel}
        isNext={item.key === nextKey}
        nextLabel={t('publicApp.me.schedule.next')}
      />
    );
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
          <div className="flex flex-col gap-4">
            {groupsForDay(dayItems).map((group) => (
              <div key={group.key}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <h3 className="truncate text-xs font-bold text-foreground">{group.title}</h3>
                  {group.kind === 'referee' && group.skillName && (
                    <SkillBadge
                      color={group.skillColor ?? 'slate'}
                      label={group.skillName}
                      size="sm"
                    />
                  )}
                </div>
                <div className="ml-1 flex flex-col gap-2 border-l-2 border-border pl-4">
                  {group.items.map((item) => (
                    <div key={item.key}>{renderCard(item)}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
