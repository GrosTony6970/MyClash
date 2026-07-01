'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { SkillBadge } from '@myclash/ui';
import { formatInZone } from '@myclash/time';
import { EventHubChrome, HubLoading, HubNotFound } from '@/components/me/EventHubChrome';
import { useI18n } from '@/i18n/I18nProvider';
import { useMyEvents, useMySchedule } from '@/components/me/hooks';
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

/** Normalised referee match-kind token → localized label. */
function matchKindLabel(t: TFn, kind: string | null, roundOfCount: number | null): string | null {
  switch (kind) {
    case 'pool':
      return t('publicApp.me.hub.kindPool');
    case 'play_in':
      return t('publicApp.me.hub.kindPlayIn');
    case 'final':
      return t('publicApp.me.hub.kindFinal');
    case 'semi_final':
      return t('publicApp.me.hub.kindSemiFinal');
    case 'quarter_final':
      return t('publicApp.me.hub.kindQuarterFinal');
    case 'round_of':
      return roundOfCount ? t('publicApp.me.hub.kindRoundOf', { count: roundOfCount }) : null;
    case 'swiss':
      return t('publicApp.me.hub.kindSwiss');
    default:
      return null;
  }
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

  const competing = myEvent.tournaments.filter((tr) => tr.registered);
  const refereeing = myEvent.refereeOf.map((r) => ({
    ...r,
    tournament: myEvent.tournaments.find((tr) => tr.name === r.tournamentName) ?? null,
  }));
  const workshops = schedule?.workshops ?? [];

  // Competing time slot = the span of the user's matches in that tournament.
  const competingSlot = (tr: MyEventTournament): string | null => {
    const starts = (schedule?.matches ?? [])
      .filter((m) => m.tournamentName === tr.name && m.scheduledAt)
      .map((m) => m.scheduledAt as string)
      .sort();
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
          <Eyebrow>{t('publicApp.me.hub.competing')}</Eyebrow>
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
                    <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-bold text-blue-700">
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
          <Eyebrow>{t('publicApp.me.hub.refereeing')}</Eyebrow>
          {refereeing.map((r, i) => {
            const kind = matchKindLabel(t, r.matchKind, r.roundOfCount);
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
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                    {t('publicApp.me.events.roleReferee')}
                  </span>
                )}
              </div>
            );
            const cardClass =
              'mb-2.5 block rounded-xl border border-border bg-surface p-4 transition-colors';
            return r.tournament ? (
              <Link
                key={i}
                href={`/me/events/${slug}/t/${r.tournament.slug}`}
                className={`${cardClass} hover:border-accent`}
              >
                {inner}
              </Link>
            ) : (
              <div key={i} className={cardClass}>
                {inner}
              </div>
            );
          })}
        </>
      )}

      {workshops.length > 0 && (
        <>
          <Eyebrow>{t('publicApp.me.hub.tabWorkshops')}</Eyebrow>
          {workshops.map((w) => {
            const meta = [daySlotLabel(w.sessionStart, w.sessionEnd, tz, tag, t), w.location]
              .filter(Boolean)
              .join(' · ');
            return (
              <Link
                key={w.workshopId}
                href={`/me/events/${slug}/workshops`}
                className="mb-2.5 block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
              >
                <p className="font-bold leading-tight">{w.workshopName}</p>
                {meta && <p className="mt-0.5 text-xs text-muted">{meta}</p>}
              </Link>
            );
          })}
        </>
      )}
    </div>
  );
}
