'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { EventHubChrome, HubLoading, HubNotFound } from '@/components/me/EventHubChrome';
import { useI18n } from '@/i18n/I18nProvider';
import { useMyEvents } from '@/components/me/hooks';
import type { MyEvent, MyEventTournament } from '@/components/me/types';

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

function CompetitionLinks({
  eventSlug,
  tournamentSlug,
  includeBracket = true,
}: {
  eventSlug: string;
  tournamentSlug: string;
  includeBracket?: boolean;
}) {
  const { t } = useI18n();
  const base = `/e/${eventSlug}/t/${tournamentSlug}`;
  const chip =
    'inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-foreground hover:border-accent hover:text-accent';
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Link href={`${base}#poolmatches`} className={chip}>
        {t('publicApp.me.hub.poolMatches')}
      </Link>
      <Link href={`${base}#standings`} className={chip}>
        {t('publicApp.me.hub.standings')}
      </Link>
      {includeBracket && (
        <Link href={`${base}#bracket`} className={chip}>
          {t('publicApp.me.hub.bracket')}
        </Link>
      )}
      <Link href={`${base}#finalranking`} className={chip}>
        {t('publicApp.me.hub.finalRanking')}
      </Link>
    </div>
  );
}

function OverviewContent({ myEvent }: { myEvent: MyEvent }) {
  const { t } = useI18n();
  const slug = myEvent.event.slug;
  const competing = myEvent.tournaments.filter((tr) => tr.registered);

  // Match each refereed pool back to its tournament (for the competition links).
  const refereeing = myEvent.refereeOf.map((r) => {
    const tournament = myEvent.tournaments.find((tr) => tr.name === r.tournamentName) ?? null;
    return { ...r, tournament };
  });

  const meta = (tr: MyEventTournament) => {
    const parts: string[] = [];
    if (tr.poolName) parts.push(t('publicApp.me.hub.pool', { name: tr.poolName }));
    if (tr.seed != null && tr.bibNumber != null)
      parts.push(t('publicApp.me.hub.seedBib', { seed: tr.seed, bib: tr.bibNumber }));
    return parts.join(' · ');
  };

  return (
    <div>
      {competing.length > 0 && (
        <>
          <Eyebrow>{t('publicApp.me.hub.competing')}</Eyebrow>
          {competing.map((tr) => (
            <div key={tr.id} className="mb-2.5 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold leading-tight">{tr.name}</p>
                  {meta(tr) && <p className="mt-0.5 text-xs text-muted">{meta(tr)}</p>}
                </div>
                {tr.poolName && (
                  <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                    {t('publicApp.me.hub.pool', { name: tr.poolName })}
                  </span>
                )}
              </div>
              <div className="my-3 h-px bg-border" />
              <Eyebrow>{t('publicApp.me.hub.competition')}</Eyebrow>
              <CompetitionLinks eventSlug={slug} tournamentSlug={tr.slug} />
            </div>
          ))}
        </>
      )}

      {refereeing.length > 0 && (
        <>
          <Eyebrow>{t('publicApp.me.hub.refereeing')}</Eyebrow>
          {refereeing.map((r, i) => (
            <div key={i} className="mb-2.5 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold leading-tight">
                    {r.tournamentName ?? r.tournament?.name ?? ''}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {[
                      r.poolName ? t('publicApp.me.hub.pool', { name: r.poolName }) : null,
                      r.role ? r.role.replace(/_/g, ' ') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                  {t('publicApp.me.events.roleReferee')}
                </span>
              </div>
              {r.tournament && (
                <>
                  <div className="my-3 h-px bg-border" />
                  <Eyebrow>{t('publicApp.me.hub.competition')}</Eyebrow>
                  <CompetitionLinks eventSlug={slug} tournamentSlug={r.tournament.slug} />
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
