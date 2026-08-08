'use client';

import { useState } from 'react';
import { useI18n } from '../../src/i18n/I18nProvider';
import { useScoringTheme } from '../../src/theme/ThemeProvider';
import { PersonRow } from '../../src/components/PersonRow';
import { useDesk, type RosterEntry } from '../../src/lib/useDesk';
import { MissingAtRisk } from './MissingAtRisk';

/**
 * The check-in desk.
 *
 * Search is the home screen, not a mode: a standing volunteer with a queue in
 * front of them should always be one keystroke from a name. An already-arrived
 * row flips its button to Undo in place, so a mis-tap is fixed without leaving
 * the search.
 *
 * Nothing here gates anything. Arrival is informational — the referee at the
 * piste is the enforcement, and no scoring or scheduling path reads it.
 */
export default function DeskPage() {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const desk = useDesk();
  const [showMissing, setShowMissing] = useState(false);

  if (showMissing) {
    return <MissingAtRisk onBack={() => setShowMissing(false)} onMark={desk.markArrived} />;
  }

  return (
    <main data-theme={chromeScope} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col p-4">
        <h1 className="mb-3 font-display text-xl font-bold">{t('scoring.desk.title')}</h1>

        {/*
          Autofocus is the point of this screen, not a convenience. The desk is
          a single-purpose surface whose entire content IS this search, worked
          by a standing volunteer with a queue in front of them — every tap
          spent putting the cursor back in the box is a person waiting. The
          a11y rule guards against stealing focus on a general page with other
          content to orient in; there is no other content here.
        */}
        <input
          type="search"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- single-purpose desk screen; the search IS the page
          autoFocus
          value={desk.query}
          onChange={(event) => desk.setQuery(event.target.value)}
          placeholder={t('scoring.desk.searchPlaceholder')}
          aria-label={t('scoring.desk.searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-lg text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent"
        />

        {desk.error && <p className="mt-3 text-sm text-danger">{t('scoring.desk.actionError')}</p>}

        <RosterList
          roster={desk.roster}
          loading={desk.loading}
          onMark={desk.markArrived}
          onUndo={desk.undoArrival}
        />

        <DeskFooter summary={desk.summary} onShowMissing={() => setShowMissing(true)} />
      </div>
    </main>
  );
}

function RosterList({
  roster,
  loading,
  onMark,
  onUndo,
}: {
  roster: RosterEntry[];
  loading: boolean;
  onMark: (personId: string) => void;
  onUndo: (personId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mt-3 flex-1 space-y-2">
      {loading && <p className="text-sm text-muted">{t('scoring.desk.loading')}</p>}
      {!loading && roster.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          {t('scoring.desk.noResults')}
        </p>
      )}
      {roster.map((person) => (
        <PersonRow
          key={person.personId}
          person={person}
          actions={<ArrivalButton person={person} onMark={onMark} onUndo={onUndo} />}
        />
      ))}
    </div>
  );
}

/** Sticky, so the running count and the escape hatch survive a long roster. */
function DeskFooter({
  summary,
  onShowMissing,
}: {
  summary: { arrived: number; total: number } | null;
  onShowMissing: () => void;
}) {
  const { t } = useI18n();

  return (
    <footer className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 border-t border-border bg-background py-3">
      <span className="text-sm text-muted">
        {summary
          ? t('scoring.desk.arrivedCount', {
              arrived: String(summary.arrived),
              total: String(summary.total),
            })
          : ''}
      </span>
      <button
        type="button"
        onClick={onShowMissing}
        className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
      >
        {t('scoring.desk.missingAtRisk')}
      </button>
    </footer>
  );
}

/**
 * One tap to mark present; the same tap position becomes Undo once they are.
 *
 * Deliberately the same slot rather than an extra Undo button: the volunteer's
 * hand is already there, and a mis-tap is corrected by tapping again.
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
        <span className="text-xs font-semibold text-success">
          {formatArrivedAt(person.arrivedAt)}
        </span>
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
    <button
      type="button"
      onClick={() => onMark(person.personId)}
      className="min-h-[44px] rounded-lg bg-accent px-5 text-sm font-bold text-accent-foreground [touch-action:manipulation]"
    >
      {t('scoring.desk.markArrived')}
    </button>
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
function formatArrivedAt(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
