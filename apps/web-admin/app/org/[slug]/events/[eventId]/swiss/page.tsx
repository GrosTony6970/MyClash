'use client';

/**
 * Swiss phase management.
 * Route: /org/[slug]/events/[eventId]/swiss
 *
 * The sibling of the Pools and Bracket routes, between them in the nav because
 * that is where the phase sits: pools → Swiss → bracket is a valid three-stage
 * tournament (decision 10), and `phases.sort_order` orders them the same way.
 *
 * Four tabs, hash-routed through the SHARED `parseHashTab` the pools shell uses.
 * Note none of the tab keys contains a hyphen — that helper splits on `-` to
 * strip a tab's inner state (`#standings-by-pool`), so a hyphenated key could
 * never match itself.
 */

import { useI18n } from '@myclash/next-i18n/client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TournamentColorDot } from '@myclash/ui';
import { parseHashTab } from '../pools/parse-hash-tab';
import { useEventStatus } from '../_hooks/useEventStatus';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { useSwissAdmin } from './useSwissAdmin';
import { ConfigureTab } from './_tabs/ConfigureTab';
import { RoundsTab } from './_tabs/RoundsTab';
import { StandingsTab } from './_tabs/StandingsTab';
import { RefereesTab } from './_tabs/RefereesTab';

type TabKey = 'configure' | 'rounds' | 'standings' | 'referees';

const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: 'configure', labelKey: 'organizer.swiss.tabs.configure' },
  { key: 'rounds', labelKey: 'organizer.swiss.tabs.rounds' },
  { key: 'standings', labelKey: 'organizer.swiss.tabs.standings' },
  { key: 'referees', labelKey: 'organizer.swiss.tabs.referees' },
];

function readHashTab(): TabKey {
  if (typeof window === 'undefined') return 'configure';
  return (
    parseHashTab(
      window.location.hash,
      TABS.map((tab) => tab.key),
    ) ?? 'configure'
  );
}

export default function SwissPage() {
  const { t } = useI18n();

  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  const apiUrl = getPublicApiUrl();
  const { isReadOnly } = useEventStatus(eventId);

  const [tournaments, setTournaments] = useState<
    Array<{ id: string; name: string; color?: string | null }>
  >([]);
  const [selectedTournament, setSelectedTournament] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabKey>('configure');

  const swiss = useSwissAdmin(selectedTournament, t('organizer.swiss.errors.loadFailed'));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs the active tab from the URL hash on mount and on hashchange
    setActiveTab(readHashTab());
    function onHash() {
      setActiveTab(readHashTab());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Silent: the picker stays empty and every tab below reports its own
    // refusal against the tournament it was asked for.
    void apiRequest<Array<{ id: string; name: string }>>(
      apiUrl,
      `/api/v1/events/${eventId}/tournaments`,
      { signal: controller.signal },
    ).then((r) => {
      if (!r.ok) return;
      setTournaments(r.data);
      if (r.data.length > 0) setTimeout(() => setSelectedTournament(r.data[0]!.id), 0);
    });
    return () => controller.abort();
  }, [eventId, apiUrl]);

  function selectTab(key: TabKey) {
    // eslint-disable-next-line react-hooks/immutability -- intentional navigation side-effect: the hashchange listener drives the tab state
    window.location.hash = `#${key}`;
  }

  const selected = tournaments.find((tour) => tour.id === selectedTournament) ?? null;
  const hasPhase = swiss.view?.phaseId != null;

  return (
    <main className="mx-auto w-full max-w-[110rem] px-6 py-8 lg:px-8">
      <nav
        aria-label={t('organizer.swiss.page.sectionsAria')}
        className="mb-6 flex gap-1 border-b border-border"
      >
        {TABS.map((tab) => {
          // Everything but Configure needs a phase to exist; Referees also
          // needs a tournament picked, because the board is event-wide.
          const disabled =
            (tab.key !== 'configure' && !hasPhase) ||
            (tab.key === 'referees' && !selectedTournament);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => !disabled && selectTab(tab.key)}
              disabled={disabled}
              title={disabled ? t('organizer.swiss.tabs.disabledHint') : undefined}
              className={[
                'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-accent text-accent'
                  : disabled
                    ? 'border-transparent text-muted cursor-not-allowed'
                    : 'border-transparent text-foreground-secondary hover:text-foreground',
              ].join(' ')}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </nav>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm text-muted">
            <Link href={`/org/${slug}`} className="hover:text-foreground-secondary">
              {slug}
            </Link>
            <span>/</span>
            <Link
              href={`/org/${slug}/events/${eventId}`}
              className="hover:text-foreground-secondary"
            >
              {t('organizer.phaseVisibility.breadcrumbEvent')}
            </Link>
            <span>/</span>
            <span className={selected ? 'text-muted' : 'font-medium text-foreground'}>
              {t('organizer.swiss.page.title')}
            </span>
            {selected && (
              <>
                <span>/</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <TournamentColorDot color={selected.color} />
                  {selected.name}
                </span>
              </>
            )}
          </div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">
            {t('organizer.swiss.page.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t('organizer.swiss.page.description')}
          </p>
        </div>
      </div>

      {tournaments.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {tournaments.map((tour) => {
            const active = selectedTournament === tour.id;
            return (
              <button
                key={tour.id}
                type="button"
                onClick={() => setSelectedTournament(tour.id)}
                className={[
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border bg-surface text-foreground-secondary hover:border-border',
                ].join(' ')}
              >
                <TournamentColorDot color={tour.color} />
                {tour.name}
              </button>
            );
          })}
        </div>
      )}

      {swiss.error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {swiss.error}
        </div>
      )}

      {!selectedTournament && (
        <p className="text-sm text-muted">{t('organizer.swiss.page.pickTournament')}</p>
      )}

      {selectedTournament && activeTab === 'configure' && (
        <ConfigureTab
          tournamentId={selectedTournament}
          swiss={swiss}
          isReadOnly={isReadOnly}
          slug={slug}
          eventId={eventId}
        />
      )}
      {selectedTournament && activeTab === 'rounds' && hasPhase && (
        <RoundsTab swiss={swiss} isReadOnly={isReadOnly} slug={slug} eventId={eventId} />
      )}
      {selectedTournament && activeTab === 'standings' && hasPhase && (
        <StandingsTab tournamentId={selectedTournament} />
      )}
      {selectedTournament && activeTab === 'referees' && hasPhase && (
        <RefereesTab eventId={eventId} tournamentId={selectedTournament} isReadOnly={isReadOnly} />
      )}
    </main>
  );
}
