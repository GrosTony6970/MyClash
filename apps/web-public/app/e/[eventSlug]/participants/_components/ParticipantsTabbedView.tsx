'use client';

/**
 * ParticipantsTabbedView — public participants page surface.
 *
 * Two-level tabs:
 *   - Main list — every person with an active registration on this
 *     event (re-uses the existing ParticipantsList behaviour).
 *   - One "Waitlist · {tournament}" tab per tournament that has at
 *     least one waitlist entry. Each tab shows the ordered queue
 *     (sorted by waitlist_position ascending).
 *
 * Hash-driven (#main / #waitlist-{slug}) so deep-links survive
 * refresh + share. Matches the pattern from the tournament page's
 * TournamentTabs.tsx.
 */

import { useEffect, useState } from 'react';
import { ParticipantsList } from './ParticipantsList';
import type { ParticipantLike } from './filter-participants';
import { useI18n } from '../../../../../src/i18n/I18nProvider';

interface WaitlistTab {
  tournamentId: string;
  tournamentSlug: string;
  tournamentName: string;
  /** Rows for this tournament's waitlist, sorted by position ASC. */
  entries: Array<{
    globalPersonId: string;
    displayName: string;
    clubName: string | null;
    clubAbbrev: string | null;
    waitlistPosition: number | null;
  }>;
}

interface Props {
  eventSlug: string;
  participants: ParticipantLike[];
}

export function ParticipantsTabbedView({ eventSlug, participants }: Props) {
  const { t: tr } = useI18n();
  // Main list: anyone with at least one 'active' registration, plus event
  // staff (referees/instructors) even when they don't compete.
  const mainList = participants.filter(
    (p) =>
      p.tournaments.some((t) => t.registrationState === 'active') || p.isReferee || p.isInstructor,
  );

  // Per-tournament waitlist tabs: collect waitlist entries per
  // tournament; sort by waitlist_position ASC; include only
  // tournaments that have at least one entry.
  const byTournament = new Map<string, WaitlistTab>();
  for (const person of participants) {
    for (const t of person.tournaments) {
      if (t.registrationState !== 'waitlist') continue;
      let tab = byTournament.get(t.id);
      if (!tab) {
        tab = {
          tournamentId: t.id,
          tournamentSlug: t.slug,
          tournamentName: t.name,
          entries: [],
        };
        byTournament.set(t.id, tab);
      }
      tab.entries.push({
        globalPersonId: person.globalPersonId,
        displayName: person.displayName,
        clubName: person.clubName,
        clubAbbrev: person.clubAbbrev,
        waitlistPosition: t.waitlistPosition ?? null,
      });
    }
  }
  const waitlistTabs = Array.from(byTournament.values())
    .map((tab) => ({
      ...tab,
      entries: tab.entries.sort(
        (a, b) => (a.waitlistPosition ?? 9999) - (b.waitlistPosition ?? 9999),
      ),
    }))
    .sort((a, b) => a.tournamentName.localeCompare(b.tournamentName));

  // Hash-driven tab key — 'main' or 'waitlist-{tournamentSlug}'.
  const [activeKey, setActiveKey] = useState<string>('main');
  useEffect(() => {
    function readHash() {
      const hash = window.location.hash.replace(/^#/, '');
      if (!hash) {
        setActiveKey('main');
        return;
      }
      if (hash === 'main') {
        setActiveKey('main');
        return;
      }
      const matched = waitlistTabs.find((t) => `waitlist-${t.tournamentSlug}` === hash);
      setActiveKey(matched ? `waitlist-${matched.tournamentSlug}` : 'main');
    }
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, [waitlistTabs]);

  function selectTab(key: string) {
    window.location.hash = key;
    setActiveKey(key);
  }

  const activeTab = waitlistTabs.find((t) => `waitlist-${t.tournamentSlug}` === activeKey);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        <button
          type="button"
          role="tab"
          aria-selected={activeKey === 'main'}
          onClick={() => selectTab('main')}
          className={
            'rounded-t-lg px-4 py-2 text-sm font-semibold transition-colors ' +
            (activeKey === 'main'
              ? 'border-x border-t border-border bg-surface text-foreground'
              : 'text-muted hover:text-foreground-secondary')
          }
        >
          {tr('publicApp.participants.mainListTab')}{' '}
          <span className="ml-1 text-xs text-muted">({mainList.length})</span>
        </button>
        {waitlistTabs.map((tab) => {
          const key = `waitlist-${tab.tournamentSlug}`;
          const selected = activeKey === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectTab(key)}
              className={
                'rounded-t-lg px-4 py-2 text-sm font-semibold transition-colors ' +
                (selected
                  ? 'border-x border-t border-border bg-surface text-foreground'
                  : 'text-muted hover:text-foreground-secondary')
              }
            >
              {tr('publicApp.participants.waitlistTab', { name: tab.tournamentName })}
              <span className="ml-1 text-xs text-warning">({tab.entries.length})</span>
            </button>
          );
        })}
      </div>

      {activeKey === 'main' && <ParticipantsList eventSlug={eventSlug} participants={mainList} />}
      {activeTab && <WaitlistView tab={activeTab} />}
    </div>
  );
}

function WaitlistView({ tab }: { tab: WaitlistTab }) {
  const { t } = useI18n();
  return (
    <section>
      <p className="mb-3 text-xs text-muted">{t('publicApp.participants.waitlistOrderHint')}</p>
      <ol className="space-y-1">
        {tab.entries.map((entry) => (
          <li
            key={entry.globalPersonId}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-warning/10 text-sm font-bold tabular-nums text-warning">
              {entry.waitlistPosition ?? '—'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground truncate">{entry.displayName}</p>
              {entry.clubName && <p className="text-xs text-muted truncate">{entry.clubName}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
