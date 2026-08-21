'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { SegmentedTabs } from '@myclash/ui';
import { failureMessage } from '@myclash/api-client';
import { useScoringTheme } from '../../src/theme/ThemeProvider';
import { MarkArrivedButton } from '../../src/components/MarkArrivedButton';
import { EventBanner } from '../../src/components/EventBanner';
import { PersonRow } from '../../src/components/PersonRow';
import { ScanOverlay } from '../../src/components/ScanOverlay';
import { RosterNotice } from '../../src/components/RosterNotice';
import { useDesk, type NextMatch, type RosterEntry } from '../../src/lib/useDesk';
import {
  countMatchingQuery,
  countsByTab,
  visibleRoster,
  type DeskCounts,
  type DeskTab,
} from '../../src/lib/desk-view';

/**
 * The check-in desk.
 *
 * Search is the home screen, not a mode: a standing volunteer with a queue in
 * front of them should always be one keystroke from a name. An already-arrived
 * row flips its button to Undo in place, so a mis-tap is fixed without leaving
 * the search.
 *
 * ── The tabs, and what happened to Missing at risk ──────────────────────────
 * Who has not arrived used to be a separate screen behind a footer button,
 * ordered by who fights soonest. It is the Not-arrived tab now: one door
 * instead of two to the same set of people, and the tab keeps the urgency
 * order, because walking to a Lice to warn a referee is still what the
 * organiser does next.
 *
 * The whole roster is in the browser, so every count on a tab is the number of
 * rows behind it rather than a separate server answer that can disagree.
 *
 * Nothing here gates anything. Arrival is informational — the referee at the
 * piste is the enforcement, and no scoring or scheduling path reads it.
 */
export default function DeskPage() {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const desk = useDesk();
  const [tab, setTab] = useState<DeskTab>('all');
  const [showScan, setShowScan] = useState(false);
  // The server's own reason, with our sentence only as the fallback. Every
  // refusal used to read "That did not save. Try again." — including a 403 from
  // the edge, which no amount of trying again would have cleared.
  const error = desk.error && failureMessage(desk.error, t, t('scoring.desk.actionError'));

  if (showScan) return <ScanLane desk={desk} onClose={() => setShowScan(false)} />;

  const counts = countsByTab(desk.roster);
  const shown = visibleRoster(desk.roster, tab, desk.query);

  return (
    <main data-theme={chromeScope} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col p-4">
        <EventBanner />
        <DeskHeader onScan={() => setShowScan(true)} />
        <DeskSearch query={desk.query} onQueryChange={desk.setQuery} />

        <DeskTabs counts={counts} value={tab} onChange={setTab} />

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <RosterNotice truncated={desk.truncated} shown={desk.roster.length} />

        <RosterList
          roster={shown}
          loading={desk.loading}
          tab={tab}
          elsewhere={countMatchingQuery(desk.roster, desk.query) - shown.length}
          onShowAll={() => setTab('all')}
          onMark={desk.markArrived}
          onUndo={desk.undoArrival}
        />
      </div>
    </main>
  );
}

/**
 * The QR fast lane, and the one refetch that closing it earns.
 *
 * One reload when the lane closes rather than one per scan: a queue of ten
 * would otherwise be ten roster round trips on venue wifi, and the overlay is
 * not showing the roster while it is open.
 */
function ScanLane({ desk, onClose }: { desk: ReturnType<typeof useDesk>; onClose: () => void }) {
  return (
    <ScanOverlay
      onScan={desk.redeemPass}
      onUndo={desk.undoArrival}
      onClose={() => {
        onClose();
        void desk.reload();
      }}
    />
  );
}

/**
 * The three ways to look at the roster, each carrying its own count.
 *
 * The count is on the label rather than beside it because a volunteer scanning
 * a tablet reads the pair as one thing: "Not arrived (63)" answers how many
 * before they have decided whether to tap.
 */
function DeskTabs({
  counts,
  value,
  onChange,
}: {
  counts: DeskCounts;
  value: DeskTab;
  onChange: (next: DeskTab) => void;
}) {
  const { t } = useI18n();

  return (
    <SegmentedTabs
      className="mt-3"
      tabs={[
        { value: 'all' as const, label: `${t('scoring.desk.tabAll')} (${counts.all})` },
        {
          value: 'arrived' as const,
          label: `${t('scoring.desk.tabArrived')} (${counts.arrived})`,
        },
        {
          value: 'notArrived' as const,
          label: `${t('scoring.desk.tabNotArrived')} (${counts.notArrived})`,
        },
      ]}
      value={value}
      onChange={onChange}
      aria-label={t('scoring.desk.tabsLabel')}
    />
  );
}

/** Title, plus the entrance to the QR lane. */
function DeskHeader({ onScan }: { onScan: () => void }) {
  const { t } = useI18n();

  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h1 className="font-display text-xl font-bold">{t('scoring.desk.title')}</h1>
      {/*
        A lane BESIDE the search box, not a mode the desk lands in. The home
        screen stays the autofocused search, and this button never takes the
        focus with it.
      */}
      <button
        type="button"
        onClick={onScan}
        className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
      >
        {t('scoring.scan.open')}
      </button>
    </div>
  );
}

/**
 * The search box, which IS this screen.
 *
 * Autofocus is the point, not a convenience: the desk is a single-purpose
 * surface worked by a standing volunteer with a queue in front of them, and
 * every tap spent putting the cursor back in the box is a person waiting. The
 * a11y rule guards against stealing focus on a general page with other content
 * to orient in; there is no other content here.
 */
function DeskSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (next: string) => void;
}) {
  const { t } = useI18n();

  return (
    <input
      type="search"
      // eslint-disable-next-line jsx-a11y/no-autofocus -- single-purpose desk screen; the search IS the page
      autoFocus
      value={query}
      onChange={(event) => onQueryChange(event.target.value)}
      placeholder={t('scoring.desk.searchPlaceholder')}
      aria-label={t('scoring.desk.searchPlaceholder')}
      className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent"
    />
  );
}

function RosterList({
  roster,
  loading,
  tab,
  elsewhere,
  onShowAll,
  onMark,
  onUndo,
}: {
  roster: RosterEntry[];
  loading: boolean;
  tab: DeskTab;
  /** People the search matches that this tab is hiding. */
  elsewhere: number;
  onShowAll: () => void;
  onMark: (personId: string) => void;
  onUndo: (personId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mt-3 flex-1 space-y-2">
      {loading && <p className="text-sm text-muted">{t('scoring.desk.loading')}</p>}
      {!loading && roster.length === 0 && (
        <EmptyState tab={tab} elsewhere={elsewhere} onShowAll={onShowAll} />
      )}
      {roster.map((person) => (
        <PersonRow
          key={person.personId}
          person={person}
          actions={<ArrivalButton person={person} onMark={onMark} onUndo={onUndo} />}
        >
          {/*
            Only where urgency is the question. On the other tabs a next-bout
            line under every row would be noise the volunteer reads past.
          */}
          {tab === 'notArrived' && <NextBout next={person.next} />}
        </PersonRow>
      ))}
    </div>
  );
}

/**
 * Nothing to show — and, when the tab is why, the way out of it.
 *
 * A volunteer sitting on the Fail tab who types a name and is told "no results"
 * has been failed by a filter they set two minutes ago. The count of matches
 * elsewhere plus one tap to reach them is what stops that.
 */
function EmptyState({
  tab,
  elsewhere,
  onShowAll,
}: {
  tab: DeskTab;
  elsewhere: number;
  onShowAll: () => void;
}) {
  const { t } = useI18n();

  if (tab === 'notArrived' && elsewhere === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
        {t('scoring.desk.everyoneArrived')}
      </p>
    );
  }

  if (tab !== 'all' && elsewhere > 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted">
          {t('scoring.desk.noResultsInTab', { count: String(elsewhere) })}
        </p>
        <button
          type="button"
          onClick={onShowAll}
          className="mt-3 min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
        >
          {t('scoring.desk.showAllMatches')}
        </button>
      </div>
    );
  }

  return (
    <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
      {t('scoring.desk.noResults')}
    </p>
  );
}

/**
 * Where and when they are next due.
 *
 * Pool and Lice are here because the organiser's next action after reading this
 * row is walking to that Lice to warn the referee — a time alone does not tell
 * them where to go.
 */
function NextBout({ next }: { next: NextMatch | null }) {
  const { t } = useI18n();

  if (!next?.scheduledAt) {
    return (
      <p className="mt-2 text-xs uppercase tracking-wide text-muted">
        {t('scoring.desk.notScheduled')}
      </p>
    );
  }

  const parts = [
    formatTime(next.scheduledAt),
    next.tournamentName,
    next.poolName,
    next.liceName,
  ].filter(Boolean);

  return <p className="mt-2 text-xs font-semibold text-warning">{parts.join(' · ')}</p>;
}

/**
 * One tap to mark present; the same tap position becomes Undo once they are.
 *
 * Deliberately the same slot rather than an extra Undo button: the volunteer's
 * hand is already there, and a mis-tap is corrected by tapping again.
 *
 * ── Both states now SAY which one they are ──────────────────────────────────
 * A not-yet-arrived row used to carry no status text at all: the button was
 * the only signal, and it was a filled `bg-accent` chip reading "Arrived". A
 * past-tense word, filled in the colour this app uses for the active state, on
 * a control nobody had pressed — volunteers read the queue as already checked
 * in. The button is an outline now and the row states its status in words, at
 * `text-base` so it is legible standing over a tablet on a table.
 */
function ArrivalButton({
  person,
  onMark,
  onUndo,
}: {
  person: RosterEntry;
  onMark: (personId: string) => void;
  onUndo: (personId: string) => void;
}) {
  const { t } = useI18n();

  if (person.arrived) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-success">{formatTime(person.arrivedAt)}</span>
        <button
          type="button"
          onClick={() => onUndo(person.personId)}
          className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
        >
          {t('scoring.desk.undo')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-base text-muted">{t('scoring.desk.notArrived')}</span>
      <MarkArrivedButton personId={person.personId} onMark={onMark} />
    </div>
  );
}

/**
 * Wall-clock time only — no date, no relative "5 minutes ago".
 *
 * The desk runs for one morning and the volunteer is comparing against the
 * clock on the wall. A relative label would also re-render every minute for no
 * benefit. Rendered from the browser's locale rather than through @myclash/time
 * because there is no span to pluralize here, only an instant.
 */
function formatTime(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
