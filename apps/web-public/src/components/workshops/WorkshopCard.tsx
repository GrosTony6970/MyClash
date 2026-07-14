'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { accentClassFor } from '@myclash/ui';
import { formatInZone, zonedDay } from '@myclash/time';
import { useI18n } from '@/i18n/I18nProvider';

type TFn = ReturnType<typeof useI18n>['t'];

export interface WorkshopListItem {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  descriptionMd: string | null;
  category: string | null;
  level: string | null;
  weapon: string | null;
  language: string | null;
  color: string | null;
  coverImageUrl: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  sessions: Array<{
    id: string;
    startsAt: string | null;
    endsAt: string | null;
    locationLabel: string | null;
    venue: { name: string } | null;
    area: { name: string } | null;
    capacity: number | null;
    confirmedCount: number;
    status?: string | null;
  }>;
  instructors: Array<{ globalPersonId: string | null; displayName: string }>;
}

/** Spots-left / almost-full / full pill — same thresholds as the public catalog. */
export function capacityBadge(confirmed: number, capacity: number, t: TFn): ReactNode {
  const pct = confirmed / capacity;
  if (pct >= 1)
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        {t('publicApp.workshops.full')}
      </span>
    );
  if (pct >= 0.8)
    return (
      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
        {t('publicApp.workshops.almostFull')}
      </span>
    );
  return (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
      {t('publicApp.workshops.spotsLeft', { count: capacity - confirmed })}
    </span>
  );
}

/** Earliest scheduled session ISO for a workshop, or null when unscheduled. */
export function firstSessionStart(w: WorkshopListItem): string | null {
  const dated = w.sessions
    .map((s) => s.startsAt)
    .filter((v): v is string => Boolean(v))
    .sort();
  return dated[0] ?? null;
}

export const WORKSHOP_UNSCHEDULED = '__unscheduled__';

export interface WorkshopDayGroup {
  key: string;
  repIso: string | null;
  items: WorkshopListItem[];
}

/** Group workshops by their earliest session's day (event tz); scheduled days
 *  ascending, the unscheduled bucket last. Shared by the public catalog and the
 *  personal-space workshops tab. */
export function groupWorkshopsByDay(list: WorkshopListItem[], tz: string): WorkshopDayGroup[] {
  const byDay = new Map<string, WorkshopListItem[]>();
  const repByDay = new Map<string, string>();
  for (const w of list) {
    const start = firstSessionStart(w);
    const key = zonedDay(start, tz) ?? WORKSHOP_UNSCHEDULED;
    const arr = byDay.get(key) ?? [];
    arr.push(w);
    byDay.set(key, arr);
    if (start) {
      const existing = repByDay.get(key);
      if (!existing || start < existing) repByDay.set(key, start);
    }
  }
  const keys = [...byDay.keys()].filter((k) => k !== WORKSHOP_UNSCHEDULED).sort();
  if (byDay.has(WORKSHOP_UNSCHEDULED)) keys.push(WORKSHOP_UNSCHEDULED);
  return keys.map((key) => ({ key, repIso: repByDay.get(key) ?? null, items: byDay.get(key)! }));
}

/** Day-group heading label, e.g. "samedi 22 mai" (rendered uppercase by CSS). */
export function workshopDayLabel(
  group: { key: string; repIso: string | null },
  tz: string,
  t: TFn,
  locale?: string,
): string {
  if (group.key === WORKSHOP_UNSCHEDULED || !group.repIso)
    return t('publicApp.workshops.dateToBeAnnounced');
  return formatInZone(group.repIso, tz, { weekday: 'long', day: 'numeric', month: 'long' }, locale);
}

export interface WorkshopCardProps {
  workshop: WorkshopListItem;
  timezone: string;
  /** Public catalog: link the whole card to the workshop detail page. */
  href?: string;
  /** Personal space: registration controls rendered under the card body. */
  footer?: ReactNode;
  /** Personal space: green accent when the user is enrolled. */
  highlighted?: boolean;
  /** Personal space: append the session location ("· Area 1") to the time line. */
  showLocation?: boolean;
}

/**
 * Workshop catalog card — coloured per-weapon stripe, title, instructors,
 * description, tag pills, capacity badge + session count, date/time line.
 * Shared by the public workshops page (link mode) and the personal-space
 * workshops tab (plain container + a register/cancel footer).
 */
export function WorkshopCard({
  workshop: w,
  timezone,
  href,
  footer,
  highlighted = false,
  showLocation = false,
}: WorkshopCardProps): ReactNode {
  const { t } = useI18n();
  const instructorNames = w.instructors.map((i) => i.displayName);
  const totalConfirmed = w.sessions.reduce((s, sess) => s + sess.confirmedCount, 0);
  const totalCapacity = w.sessions.reduce((s, sess) => s + (sess.capacity ?? 0), 0);
  const description = w.descriptionMd ?? w.shortDescription;
  // Earliest scheduled session drives the date/time line; extra sessions are
  // flagged with "+N more".
  const datedSessions = w.sessions
    .filter((s) => s.startsAt)
    .sort((a, b) => (a.startsAt! < b.startsAt! ? -1 : 1));
  const firstSession = datedSessions[0] ?? null;
  const moreCount = datedSessions.length - 1;
  // An explicit locationLabel wins; otherwise show venue and area together
  // ("Salle Principale — Area 1"), degrading gracefully when a part is missing.
  const location = (() => {
    if (!firstSession) return null;
    if (firstSession.locationLabel) return firstSession.locationLabel;
    const parts = [firstSession.venue?.name, firstSession.area?.name].filter(Boolean);
    return parts.length ? parts.join(' — ') : null;
  })();

  // Personal-space cards (no href) let the reader expand a clamped description;
  // public cards link to the detail page instead, so keep them clamped.
  const expandable = !href;
  const descRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    if (!expandable || expanded) return;
    const el = descRef.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expandable, expanded, description]);

  const surface = highlighted ? 'border-success/40 bg-success/5' : 'border-stone-200 bg-white';

  const body = (
    <>
      {w.color && (
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-1 ${accentClassFor(w.color)}`}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        {w.coverImageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={w.coverImageUrl}
            alt=""
            className="h-11 w-11 flex-shrink-0 rounded-md object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-slate-900">{w.title}</h3>
          {instructorNames.length > 0 && (
            <p className="mt-0.5 text-sm text-slate-500">{instructorNames.join(', ')}</p>
          )}
          {description && (
            <>
              <p
                ref={expandable ? descRef : undefined}
                className={`mt-2 text-sm text-slate-600 ${expandable && expanded ? '' : 'line-clamp-2'}`}
              >
                {description}
              </p>
              {expandable && overflowing && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 text-xs font-medium text-red-600 hover:text-red-700"
                >
                  {expanded ? t('publicApp.workshops.showLess') : t('publicApp.workshops.showMore')}
                </button>
              )}
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {w.weapon && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {w.weapon}
              </span>
            )}
            {w.category && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-600">
                {w.category}
              </span>
            )}
            {w.level && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                {w.level}
              </span>
            )}
            {w.durationMinutes != null && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-500">
                {t('publicApp.workshops.durationMinutes', { count: w.durationMinutes })}
              </span>
            )}
            {w.language && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-slate-500">
                {w.language.toUpperCase()}
              </span>
            )}
          </div>
          {firstSession?.startsAt && (
            <p className="mt-3 text-xs font-medium text-slate-500">
              {formatInZone(firstSession.startsAt, timezone, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {firstSession.endsAt &&
                `–${formatInZone(firstSession.endsAt, timezone, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`}
              {showLocation && location && <span className="text-slate-400"> · {location}</span>}
              {moreCount > 0 && (
                <span className="text-slate-400">
                  {' '}
                  · {t('publicApp.workshops.moreSessions', { count: moreCount })}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          {totalCapacity > 0 && capacityBadge(totalConfirmed, totalCapacity, t)}
          <p className="mt-1 text-xs text-slate-400">
            {w.sessions.length === 1
              ? t('publicApp.workshops.sessionCountSingular', { count: w.sessions.length })
              : t('publicApp.workshops.sessionCountPlural', { count: w.sessions.length })}
          </p>
        </div>
      </div>
      {footer && <div className="mt-4">{footer}</div>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group relative block overflow-hidden rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition-colors hover:border-red-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500/40"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-xl border ${surface} p-5 shadow-sm`}>
      {body}
    </div>
  );
}
