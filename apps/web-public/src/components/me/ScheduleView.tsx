'use client';

import { formatInZone } from '@myclash/time';
import { EmptyState, SkillBadge, useNow } from '@myclash/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { getApiUrl } from '../../lib/api-url';
import { CollapsibleSection } from './CollapsibleSection';
import { CommitmentCard } from './CommitmentCard';
import { detectConflicts, toTimed, type TimedItem } from './conflicts';
import { kindAccentClass } from './kind-accent';
import { matchKindHash, matchKindLabel } from './match-kind';
import { programmeTint } from './programme-tint';
import { aggregateReferee, partitionAtBars, type RefereeAggregate } from './schedule-model';
import { classifyTime, type TemporalState } from './schedule-time';
import type {
  PersonSchedule,
  ProgrammeContextRow,
  ScheduleMatch,
  WorkshopEnrollment,
} from './types';

const DEFAULT_TZ = 'Europe/Paris';

type DisplayItem =
  | { kind: 'fight'; key: string; time: string | null; data: ScheduleMatch }
  | { kind: 'referee'; key: string; time: string | null; data: RefereeAggregate }
  | { kind: 'workshop'; key: string; time: string | null; data: WorkshopEnrollment };

/** A sub-group of same-tournament fights / same-tournament referee assignments /
 *  enrolled workshops, rendered under one collapsible title + a connecting thread. */
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
  /** Non-commitment programme blocks (lunch, ceremonies…) shown as context. */
  programme,
  /** When set, render the "Updated HH:MM (· offline)" stale badge. */
  updatedAt,
  offline = false,
}: {
  schedule: PersonSchedule;
  timezone: string | null;
  eventSlug?: string;
  programme?: ProgrammeContextRow[];
  updatedAt?: number | null;
  offline?: boolean;
}): ReactNode {
  const { t, locale } = useI18n();
  const tz = timezone ?? DEFAULT_TZ;
  const tag = localeTag(locale);

  // Live "now" clock so LIVE / NEXT track the current time and advance as the
  // event unfolds. `useNow` also honours an active super-admin time simulation
  // (the `time_simulation` feature flag). ScheduleView only ever mounts on the
  // client, so it never hydrates on the server.
  const now = useNow(getApiUrl());

  // Retractable day + weapon sections. Default expanded (a key present in the set
  // is collapsed); state is in-memory for the tab's lifetime.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isOpen = (key: string) => !collapsed.has(key);

  const fmtTime = (iso: string | null) =>
    iso
      ? formatInZone(iso, tz, { hour: '2-digit', minute: '2-digit' }, tag)
      : t('publicApp.me.schedule.tbd');
  const fmtDay = (iso: string) =>
    formatInZone(iso, tz, { weekday: 'long', day: 'numeric', month: 'long' }, tag);

  // Fold the many per-match referee slots into one card per pool / bracket tier.
  const referees = aggregateReferee(schedule.refereeSlots);

  const refereePhaseLabel = (r: RefereeAggregate): string | null => {
    const kind = matchKindLabel(t, r.matchKind, r.roundOfCount);
    // Pool phase: `poolName` already reads "Pool N", so drop the redundant "Pool"
    // kind; bracket phases keep their distinct kind label ("Final", "Round of 16").
    return r.matchKind === 'pool' ? (r.poolName ?? kind) : (kind ?? r.poolName);
  };
  const refereeTitle = (r: RefereeAggregate): string => {
    const phase = refereePhaseLabel(r);
    const ref = t('publicApp.me.schedule.referee');
    return phase ? `${ref} · ${phase}` : ref;
  };

  // Conflict detection spans matches + referee windows + workshops (bidirectional).
  const timed: TimedItem[] = [
    ...schedule.matches.flatMap((m) => {
      const ti = toTimed(`fight-${m.id}`, m.opponentName ?? m.matchNumberLabel, m.scheduledAt);
      return ti ? [ti] : [];
    }),
    ...referees.flatMap((r) =>
      r.startMs != null && r.endMs != null
        ? [{ key: r.key, label: refereeTitle(r), start: r.startMs, end: r.endMs }]
        : [],
    ),
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
    ...referees.map(
      (r): DisplayItem => ({ kind: 'referee', key: r.key, time: r.startIso, data: r }),
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

  // Classify each commitment against the real clock (LIVE = in progress now;
  // NEXT = first still-upcoming). Referee aggregates classify by their [start,end]
  // window, like workshops.
  const states = new Map<string, TemporalState>(
    items.map((i) => [
      i.key,
      classifyTime(
        {
          kind: i.kind,
          startMs: i.time ? new Date(i.time).getTime() : null,
          endMs:
            i.kind === 'workshop'
              ? i.data.sessionEnd
                ? new Date(i.data.sessionEnd).getTime()
                : null
              : i.kind === 'referee'
                ? i.data.endMs
                : null,
          status: i.kind === 'fight' ? i.data.status : undefined,
        },
        now,
      ),
    ]),
  );
  const liveKeys = new Set([...states].filter(([, s]) => s === 'live').map(([key]) => key));
  const nextKey = items.find((i) => states.get(i.key) === 'upcoming')?.key;

  // On open, jump to whatever is happening now (LIVE), else the next upcoming
  // commitment. Runs once — later clock ticks must not yank the scroll.
  const scrollTargetKey = items.find((i) => liveKeys.has(i.key))?.key ?? nextKey ?? null;
  const didScrollRef = useRef(false);
  useEffect(() => {
    if (didScrollRef.current || !scrollTargetKey) return;
    const el = document.getElementById(scrollTargetKey);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
      didScrollRef.current = true;
    }
  }, [scrollTargetKey]);

  if (items.length === 0) {
    return <EmptyState title={t('publicApp.me.schedule.emptyAll')} />;
  }

  // Group commitments by calendar day (event-local); programme bars keyed by the
  // same day format so they render under the day they fall on.
  const byDay = new Map<string, DisplayItem[]>();
  for (const item of items) {
    const day = item.time
      ? formatInZone(item.time, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, tag)
      : 'unscheduled';
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  const programmeByDay = new Map<string, ProgrammeContextRow[]>();
  for (const row of programme ?? []) {
    const day = formatInZone(
      row.start,
      tz,
      { year: 'numeric', month: '2-digit', day: '2-digit' },
      tag,
    );
    programmeByDay.set(day, [...(programmeByDay.get(day) ?? []), row]);
  }

  function groupKeyOf(item: DisplayItem): string {
    if (item.kind === 'fight') return `f:${item.data.tournamentName ?? ''}`;
    if (item.kind === 'referee') return `r:${item.data.tournamentName ?? ''}`;
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

  function groupsFor(segItems: DisplayItem[]): Group[] {
    const map = new Map<string, Group>();
    for (const item of segItems) {
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

  // A day is a chronological sequence of programme bars (hard dividers) and
  // segments (break-free spans of commitments grouped by weapon). A weapon that
  // straddles a break therefore appears as a section on either side of the bar.
  type DayRow =
    | { type: 'bar'; bar: ProgrammeContextRow }
    | { type: 'segment'; index: number; groups: Group[] };

  function rowsForDay(day: string, dayItems: DisplayItem[]): DayRow[] {
    const slices = partitionAtBars(
      dayItems.map((item) => ({
        item,
        sort: item.time ? new Date(item.time).getTime() : Infinity,
      })),
      (programmeByDay.get(day) ?? []).map((bar) => ({ bar, sort: new Date(bar.start).getTime() })),
    );
    return slices.map(
      (slice): DayRow =>
        slice.type === 'bar'
          ? { type: 'bar', bar: slice.bar }
          : { type: 'segment', index: slice.index, groups: groupsFor(slice.items) },
    );
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
          isLive={liveKeys.has(item.key)}
          liveLabel={t('publicApp.me.schedule.live')}
          side={m.isRed ? 'red' : 'blue'}
          href={
            eventSlug
              ? `/e/${eventSlug}/match/${m.id}?return=${encodeURIComponent(
                  `/me/events/${eventSlug}/schedule`,
                )}`
              : undefined
          }
        />
      );
    }
    if (item.kind === 'referee') {
      const r = item.data;
      return (
        <CommitmentCard
          kind="referee"
          timeLabel={fmtTime(r.startIso)}
          place={r.liceName}
          title={refereeTitle(r)}
          meta={t(
            r.count === 1
              ? 'publicApp.me.schedule.matchCountOne'
              : 'publicApp.me.schedule.matchCount',
            { count: r.count },
          )}
          conflict={conflictLabel}
          isNext={item.key === nextKey}
          nextLabel={t('publicApp.me.schedule.next')}
          isLive={liveKeys.has(item.key)}
          liveLabel={t('publicApp.me.schedule.live')}
          href={
            eventSlug && r.tournamentSlug
              ? `/me/events/${eventSlug}/t/${r.tournamentSlug}${matchKindHash(r.matchKind)}`
              : undefined
          }
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
        isLive={liveKeys.has(item.key)}
        liveLabel={t('publicApp.me.schedule.live')}
        href={
          eventSlug && w.workshopSlug
            ? `/me/events/${eventSlug}/workshops#workshop-${w.workshopSlug}`
            : undefined
        }
      />
    );
  }

  function renderBar(row: ProgrammeContextRow): ReactNode {
    const tint = programmeTint(row.colorHex);
    return (
      <div
        style={
          tint
            ? { borderColor: tint.borderColor, backgroundColor: tint.backgroundColor }
            : undefined
        }
        className={[
          'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
          tint ? 'text-foreground' : 'border-border bg-background/60 text-muted',
        ].join(' ')}
      >
        <span className="shrink-0 font-bold tabular-nums text-foreground">
          {fmtTime(row.start)}
          {row.end ? `–${fmtTime(row.end)}` : ''}
        </span>
        <span className="truncate font-medium">{row.label}</span>
      </div>
    );
  }

  function renderDayBody(day: string, dayItems: DisplayItem[]): ReactNode {
    return rowsForDay(day, dayItems).map((row) => {
      if (row.type === 'bar') {
        return <div key={`bar-${row.bar.id}`}>{renderBar(row.bar)}</div>;
      }
      return (
        <div key={`seg-${row.index}`} className="flex flex-col gap-3">
          {row.groups.map((group) => {
            const secKey = `sec:${day}:${row.index}:${group.key}`;
            return (
              <CollapsibleSection
                key={secKey}
                open={isOpen(secKey)}
                onToggle={() => toggle(secKey)}
                headerClassName="mb-1.5"
                bodyClassName="ml-1 flex flex-col gap-2 border-l-2 border-border pl-4"
                header={
                  <>
                    <span
                      aria-hidden="true"
                      className={[
                        'h-2 w-2 shrink-0 rounded-full',
                        kindAccentClass(group.kind),
                      ].join(' ')}
                    />
                    <span className="truncate text-xs font-bold text-foreground">
                      {group.title}
                    </span>
                    {group.kind === 'referee' && group.skillName && (
                      <SkillBadge
                        color={group.skillColor ?? 'slate'}
                        label={group.skillName}
                        size="sm"
                      />
                    )}
                  </>
                }
              >
                {group.items.map((item) => (
                  <div key={item.key} id={item.key}>
                    {renderCard(item)}
                  </div>
                ))}
              </CollapsibleSection>
            );
          })}
        </div>
      );
    });
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

      {[...byDay.entries()].map(([day, dayItems]) =>
        day === 'unscheduled' ? (
          <section key={day} className="mb-4">
            <div className="flex flex-col gap-3 pl-3 sm:pl-4">{renderDayBody(day, dayItems)}</div>
          </section>
        ) : (
          <section key={day} className="mb-4">
            <CollapsibleSection
              open={isOpen(`day:${day}`)}
              onToggle={() => toggle(`day:${day}`)}
              headerClassName="mb-2 mt-1"
              bodyClassName="flex flex-col gap-3 pl-3 sm:pl-4"
              header={
                <span className="truncate font-display text-lg font-bold text-foreground">
                  {fmtDay(dayItems.find((i) => i.time)?.time ?? day)}
                </span>
              }
            >
              {renderDayBody(day, dayItems)}
            </CollapsibleSection>
          </section>
        ),
      )}
    </div>
  );
}
