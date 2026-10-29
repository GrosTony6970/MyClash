'use client';

import { useI18n } from '@myclash/next-i18n/client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminPageHeader, useLeaveGuard } from '@myclash/ui';
import { apiRequest, isApiForbidden } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { BasicsTab } from './_components/BasicsTab';
import { MatchFormatTab } from './_components/MatchFormatTab';
import { DisplayTab } from './_components/DisplayTab';
import { AdvancedTab } from './_components/AdvancedTab';
import { LocksTab } from './_components/LocksTab';
import { RecapTab } from './_components/RecapTab';
import { RulesetDriftBanner } from './_components/RulesetDriftBanner';
import { TournamentVenuesEditor } from '../../_components/TournamentVenuesEditor';
import { BackLink } from '@/components/BackLink';
import { useEventStatus } from '../../../_hooks/useEventStatus';

const apiUrl = getPublicApiUrl();

type TabKey = 'basics' | 'match-format' | 'venues' | 'display' | 'advanced' | 'locks' | 'recap';

const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: 'basics', labelKey: 'organizer.tournaments.settings.basics' },
  { key: 'match-format', labelKey: 'organizer.tournaments.settings.matchFormat' },
  { key: 'venues', labelKey: 'organizer.tournaments.settings.venues' },
  { key: 'display', labelKey: 'organizer.tournaments.settings.display' },
  { key: 'advanced', labelKey: 'organizer.tournaments.settings.advanced' },
  { key: 'locks', labelKey: 'organizer.tournaments.settings.locks' },
  { key: 'recap', labelKey: 'organizer.tournaments.settings.recap' },
];

function readHashTab(): TabKey {
  if (typeof window === 'undefined') return 'basics';
  const hash = window.location.hash.replace('#', '');
  return TABS.find((tab) => tab.key === hash)?.key ?? 'basics';
}

export default function TournamentSettingsPage() {
  const { t } = useI18n();

  const params = useParams<{ slug: string; eventId: string; tournamentId: string }>();
  const router = useRouter();
  // An archived Event: the server refuses every save here but the Recap's (rulings 377, 379).
  const { isReadOnly } = useEventStatus(params.eventId);
  // The open tab holds edits not saved yet (O15). Each tab reads afresh when it opens, so a
  // switch, a link or closing the browser tab asks first.
  const [dirty, setDirty] = useState(false);
  const { askToLeave, confirmDialog } = useLeaveGuard(dirty, { t, navigate: router.push });
  const { name, setName, mayEdit } = useTournamentHeader(params.tournamentId);
  // Below admin, the server refuses every save here, the Recap's too (rulings 101-103).
  const adminOnly = mayEdit ? undefined : t('organizer.tournaments.settings.adminOnly');
  // Each save of the rules: the drift banner reads again (revision 10 fold 7).
  const [rulesSavedAt, setRulesSavedAt] = useState(0);
  const tab = {
    tournamentId: params.tournamentId,
    readOnly: isReadOnly || !mayEdit,
    readOnlyWhy: isReadOnly ? t('organizer.deletionRequest.archivedReadOnly') : adminOnly,
    onDirtyChange: setDirty,
    onRulesSaved: () => setRulesSavedAt((n) => n + 1),
  };
  const [active, setActive] = useState<TabKey>('basics');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync active tab from window.location.hash on mount (SSR-safe initial 'basics', client reads real hash)
    setActive(readHashTab());
    function onHash() {
      setActive(readHashTab());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  async function selectTab(key: TabKey) {
    if (key === active || !(await askToLeave())) return;
    // eslint-disable-next-line react-hooks/immutability -- intentional navigation side effect; setting location.hash fires hashchange which updates state
    window.location.hash = `#${key}`;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
      <BackLink
        href={`/org/${params.slug}/events/${params.eventId}/tournaments`}
        label={t('organizer.tournaments.settings.backToList')}
      />
      <div className="mt-4">
        <AdminPageHeader
          eyebrow={t('organizer.tournaments.settings.eyebrow')}
          title={name ?? t('organizer.tournaments.settings.title')}
          subtitle={t('organizer.tournaments.settings.subtitle')}
        />
      </div>
      {adminOnly && (
        <p
          role="status"
          className="mt-4 rounded-md border border-border px-4 py-3 text-sm text-foreground-secondary"
        >
          {adminOnly}
        </p>
      )}

      <RulesetDriftBanner {...tab} rulesSavedAt={rulesSavedAt} />

      <div className="mt-6 grid grid-cols-[200px_1fr] gap-8">
        <nav
          aria-label={t('admin.orgTournaments.settingsSectionsNav')}
          className="flex flex-col gap-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => void selectTab(tab.key)}
              className={[
                'text-left px-3 py-2 rounded-md text-sm font-medium transition-colors',
                active === tab.key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground-secondary hover:bg-background',
              ].join(' ')}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        <section>
          {active === 'basics' && <BasicsTab {...tab} onNameSaved={setName} />}
          {active === 'match-format' && <MatchFormatTab {...tab} />}
          {active === 'venues' && <TournamentVenuesEditor {...tab} eventId={params.eventId} />}
          {active === 'display' && <DisplayTab {...tab} />}
          {active === 'advanced' && <AdvancedTab {...tab} />}
          {active === 'locks' && <LocksTab {...tab} />}
          {active === 'recap' && (
            <RecapTab tournamentId={params.tournamentId} closedWhy={adminOnly} />
          )}
        </section>
      </div>
      {confirmDialog}
    </main>
  );
}

/**
 * The Tournament's name, for the header; null until it is read, and if the read fails. The
 * setter takes the name Basics saved: the header used to keep the old one.
 *
 * `mayEdit` is false when the read says its reader is below admin, or when the API refuses the
 * read itself (a read_only member): the server refuses them every save here (ruling 101). A read
 * that does not say (pending, failed, an edge's 403) leaves the page open: the server still refuses.
 */
function useTournamentHeader(tournamentId: string) {
  const [name, setName] = useState<string | null>(null);
  const [mayEdit, setMayEdit] = useState(true);
  useEffect(() => {
    let current = true;
    void apiRequest<{ name?: string; viewer_may_edit?: boolean }>(
      apiUrl,
      `/api/v1/tournaments/${tournamentId}`,
    ).then((r) => {
      if (!current) return;
      if (r.ok) setName(r.data.name ?? null);
      setMayEdit(r.ok ? r.data.viewer_may_edit !== false : !isApiForbidden(r));
    });
    return () => {
      current = false;
    };
  }, [tournamentId]);
  return { name, setName, mayEdit };
}
