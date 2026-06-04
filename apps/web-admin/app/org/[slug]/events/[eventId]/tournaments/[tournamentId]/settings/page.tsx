'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AdminPageHeader } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { BasicsTab } from './_components/BasicsTab';
import { MatchFormatTab } from './_components/MatchFormatTab';
import { DisplayTab } from './_components/DisplayTab';
import { AdvancedTab } from './_components/AdvancedTab';
import { LocksTab } from './_components/LocksTab';

type TabKey = 'basics' | 'match-format' | 'display' | 'advanced' | 'locks';

const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: 'basics', labelKey: 'organizer.tournaments.settings.basics' },
  { key: 'match-format', labelKey: 'organizer.tournaments.settings.matchFormat' },
  { key: 'display', labelKey: 'organizer.tournaments.settings.display' },
  { key: 'advanced', labelKey: 'organizer.tournaments.settings.advanced' },
  { key: 'locks', labelKey: 'organizer.tournaments.settings.locks' },
];

function readHashTab(): TabKey {
  if (typeof window === 'undefined') return 'basics';
  const hash = window.location.hash.replace('#', '');
  return TABS.find((tab) => tab.key === hash)?.key ?? 'basics';
}

export default function TournamentSettingsPage() {
  const params = useParams<{ slug: string; eventId: string; tournamentId: string }>();
  const [active, setActive] = useState<TabKey>('basics');

  useEffect(() => {
    setActive(readHashTab());
    function onHash() {
      setActive(readHashTab());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function selectTab(key: TabKey) {
    window.location.hash = `#${key}`;
  }

  return (
    <main id="main-content" className="mx-auto w-full px-6 py-12 lg:px-8">
      <Link
        href={`/org/${params.slug}/events/${params.eventId}/tournaments`}
        className="inline-flex items-center gap-1 rounded text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
      >
        ← {t('organizer.tournaments.settings.backToList')}
      </Link>
      <div className="mt-4">
        <AdminPageHeader
          eyebrow="Tournament"
          title={t('organizer.tournaments.settings.title')}
          subtitle={t('organizer.tournaments.settings.subtitle')}
        />
      </div>

      <div className="mt-6 grid grid-cols-[200px_1fr] gap-8">
        <nav aria-label="Settings sections" className="flex flex-col gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectTab(tab.key)}
              className={[
                'text-left px-3 py-2 rounded-md text-sm font-medium transition-colors',
                active === tab.key ? 'bg-red-800 text-white' : 'text-slate-700 hover:bg-slate-100',
              ].join(' ')}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        <section>
          {active === 'basics' && <BasicsTab tournamentId={params.tournamentId} />}
          {active === 'match-format' && <MatchFormatTab tournamentId={params.tournamentId} />}
          {active === 'display' && <DisplayTab tournamentId={params.tournamentId} />}
          {active === 'advanced' && <AdvancedTab tournamentId={params.tournamentId} />}
          {active === 'locks' && <LocksTab tournamentId={params.tournamentId} />}
        </section>
      </div>
    </main>
  );
}
