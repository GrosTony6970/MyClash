'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { SkillBadge } from '@myclash/ui';
import { formatInZone } from '@myclash/time';
import { EventHubChrome, HubLoading, HubNotFound } from '@/components/me/EventHubChrome';
import { useI18n } from '@/i18n/I18nProvider';
import { useMyEvents, useMySchedule } from '@/components/me/hooks';
import { matchKindHash, matchKindLabel } from '@/components/me/match-kind';
import { buildWorkshopRows } from '@/components/me/workshop-rows';
import {
  buildCompetingRows,
  buildRefereeRows,
  competingStarts,
} from '@/components/me/overview-rows';
import type { MyEvent, MyEventTournament } from '@/components/me/types';

type TFn = ReturnType<typeof useI18n>['t'];

/** Per-event hub — Overview is the default landing tab. */
export default function HubOverviewPage() {
  const { eventSlug } = useParams<{ eventSlug: string }>();
  const { events, loading } = useMyEvents();
  const myEvent = events?.find((e) => e.event.slug === eventSlug) ?? null;

  if (loading) return <HubLoading />;
  if (!myEvent) return <HubNotFound />;

  return (
    <EventHubChrome event={myEvent.event} active="overview">
      <OverviewContent myEvent={myEvent} />
    </EventHubChrome>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted first:mt-0">
      {children}
    </p>
  );
}

/** Prominent heading for the top-level sections (Competing / Refereeing /
 *  Workshops). Matches the event-title style in EventHubChrome so the sections
 *  read as real headings rather than faint eyebrows. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2.5 mt-6 font-display text-lg font-bold text-foreground first:mt-0">
      {children}
    </h2>
  );
}

/** Quick-link chips that open the IN-APP tournament view (not the public page),
 *  deep-linked to the relevant tab. */
function CompetitionLinks({
  eventSlug,
  tournamentSlug,
}: {
  eventSlug: string;
  tournamentSlug: string;
}) {
  const { t } = useI18n();
  const base = `/me/events/${eventSlug}/t/${tournamentSlug}`;
  const chip =
    'inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-foreground hover:border-accent hover:text-accent';
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link href={`${base}#pools`} className={chip}>
        {t('publicApp.me.hub.poolList')}
      </Link>
      <Link href={`${base}#poolmatches`} className={chip}>
        {t('publicApp.me.hub.poolMatches')}
      </Link>
      <Link href={`${base}#standings`} className={chip}>
        {t('publicApp.me.hub.standings')}
      </Link>
      <Link href={`${base}#bracket`} className={chip}>
        {t('publicApp.me.hub.bracket')}
      </Link>
      <Link href={`${base}#finalranking`} className={chip}>
        {t('publicApp.me.hub.finalRanking')}
      </Link>
    </div>
  );
}

/** "Sat 22 May · 10:30–13:45" (event tz), or the TBD label when unscheduled. */
function daySlotLabel(
  start: string | null,
  end: string | null,
  tz: string,
  tag: string,
  t: TFn,
): string {
  if (!start) return t('publicApp.me.schedule.tbd');
  const day = formatInZone(start, tz, { weekday: 'short', day: 'numeric', month: 'short' }, tag);
  const a = formatInZone(start, tz, { hour: '2-digit', minute: '2-digit' }, tag);
  const b = end ? formatInZone(end, tz, { hour: '2-digit', minute: '2-digit' }, tag) : null;
  return `${day} · ${b && b !== a ? `${a}–${b}` : a}`;
}

function OverviewContent({ myEvent }: { myEvent: MyEvent }) {
  const { t, locale } = useI18n();
  const tag = locale === 'fr' ? 'fr-FR' : 'en-GB';
  const tz = myEvent.event.timezone ?? 'Europe/Paris';
  const slug = myEvent.event.slug;
  const { schedule } = useMySchedule(myEvent.event.id);

  // Every section is ordered by time, unscheduled last — see overview-rows.ts.
  // Competing settles into order once the (separate) schedule fetch resolves.
  const matches = schedule?.matches ?? [];
  const competing = buildCompetingRows(myEvent.tournaments, matches);
  const refereeing = buildRefereeRows(myEvent.refereeOf, myEvent.tournaments);
  // Unified Workshops section: workshops the user TEACHES (instructor) + those
  // they ATTEND (enrolled), merged/deduped/sorted by buildWorkshopRows.
  const workshops = buildWorkshopRows(myEvent.workshopsTeaching, schedule?.workshops ?? [], slug);

  // Competing time slot = the span of the user's matches in that tournament.
  const competingSlot = (tr: MyEventTournament): string | null => {
    const starts = competingStarts(tr, matches);
    if (starts.length === 0) return null;
    return daySlotLabel(starts[0]!, starts[starts.length - 1]!, tz, tag, t);
  };

  const competingMeta = (tr: MyEventTournament): string | null => {
    const slot = competingSlot(tr);
    const parts = [
      tr.seed != null && tr.bibNumber != null
        ? t('publicApp.me.hub.seedBib', { seed: tr.seed, bib: tr.bibNumber })
        : null,
      slot,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  return (
    <div>
      {competing.length > 0 && (
        <>
          <SectionTitle>{t('publicApp.me.hub.competing')}</SectionTitle>
          {competing.map((tr) => {
            const meta = competingMeta(tr);
            return (
              <div key={tr.id} className="mb-2.5 rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold leading-tight">{tr.name}</p>
                    {meta && <p className="mt-0.5 text-xs text-muted">{meta}</p>}
                  </div>
                  {tr.poolName && (
                    <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">
                      {tr.poolName}
                    </span>
                  )}
                </div>
                <div className="my-3 h-px bg-border" />
                <Eyebrow>{t('publicApp.me.hub.competition')}</Eyebrow>
                <CompetitionLinks eventSlug={slug} tournamentSlug={tr.slug} />
              </div>
            );
          })}
        </>
      )}

      {refereeing.length > 0 && (
        <>
          <SectionTitle>{t('publicApp.me.hub.refereeing')}</SectionTitle>
          {refereeing.map((r) => {
            const kind = matchKindLabel(t, r.matchKind, r.roundOfCount, r.swissRound);
            // Pool phase: `poolName` already reads "Pool N", so the localized
            // "Pool" kind would be redundant ("Pool 1 · Pool"). Drop it there;
            // bracket phases keep their distinct kind label ("Final", …).
            const phaseLabel = r.matchKind === 'pool' ? (r.poolName ?? kind) : (kind ?? r.poolName);
            // Pool + lice are the prominent, enlarged tokens ("Pool 1 · Lice 1").
            const prominent = [phaseLabel, r.liceName].filter(Boolean).join(' · ');
            const slot = daySlotLabel(r.startsAt, r.endsAt, tz, tag, t);
            const inner = (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold leading-tight">
                    {r.tournamentName ?? r.tournament?.name ?? ''}
                  </p>
                  {(prominent || slot) && (
                    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                      {prominent && (
                        <span className="text-sm font-semibold text-foreground">{prominent}</span>
                      )}
                      {prominent && slot && <span className="text-xs text-muted">·</span>}
                      {slot && <span className="text-xs text-muted">{slot}</span>}
                    </p>
                  )}
                  {r.venueName && <p className="mt-0.5 text-xs text-muted">{r.venueName}</p>}
                </div>
                {r.skillName ? (
                  <SkillBadge color={r.skillColor ?? 'slate'} label={r.skillName} size="sm" />
                ) : (
                  <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning">
                    {t('publicApp.me.events.roleReferee')}
                  </span>
                )}
              </div>
            );
            const cardClass =
              'mb-2.5 block rounded-xl border border-border bg-surface p-4 transition-colors';
            return r.tournament ? (
              <Link
                key={r.id}
                href={`/me/events/${slug}/t/${r.tournament.slug}${matchKindHash(r.matchKind)}`}
                className={`${cardClass} hover:border-accent`}
              >
                {inner}
              </Link>
            ) : (
              <div key={r.id} className={cardClass}>
                {inner}
              </div>
            );
          })}
        </>
      )}

      {workshops.length > 0 && (
        <>
          <SectionTitle>{t('publicApp.me.hub.tabWorkshops')}</SectionTitle>
          {workshops.map((w) => {
            const meta = [daySlotLabel(w.start, w.end, tz, tag, t), w.location]
              .filter(Boolean)
              .join(' · ');
            return (
              <Link
                key={w.key}
                href={w.href}
                className="mb-2.5 block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold leading-tight">{w.name}</p>
                    {meta && <p className="mt-0.5 text-xs text-muted">{meta}</p>}
                  </div>
                  {w.involvement === 'teaching' ? (
                    <span className="shrink-0 rounded-full bg-instructor/15 px-2 py-0.5 text-[11px] font-bold text-instructor">
                      {t('publicApp.me.events.roleInstructor')}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">
                      {t('publicApp.me.events.roleParticipant')}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </>
      )}
    </div>
  );
}
