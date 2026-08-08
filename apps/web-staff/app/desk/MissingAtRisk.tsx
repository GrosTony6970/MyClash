'use client';

import { useI18n } from '../../src/i18n/I18nProvider';
import { useScoringTheme } from '../../src/theme/ThemeProvider';
import { PersonRow } from '../../src/components/PersonRow';
import { useMissingAtRisk, type MissingFighter } from '../../src/lib/useDesk';

interface Props {
  onBack: () => void;
  onMark: (personId: string) => void;
}

/**
 * Who has not arrived, ordered by how soon they fight.
 *
 * The organiser's screen and the payoff of capturing arrival at all. Marking
 * present is available from here too, because the organiser chasing someone
 * often finds them before the desk does.
 *
 * Fighters with no scheduled bout sit in a group at the end rather than being
 * hidden: they are still missing, just not yet costing anyone time.
 */
export function MissingAtRisk({ onBack, onMark }: Props) {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const { missing, loading } = useMissingAtRisk(true);

  return (
    <main data-theme={chromeScope} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-semibold"
          >
            {t('scoring.desk.backToDesk')}
          </button>
          <h1 className="font-display text-xl font-bold">{t('scoring.desk.missingTitle')}</h1>
          <span className="text-sm text-muted">{missing.length}</span>
        </div>

        {loading && <p className="text-sm text-muted">{t('scoring.desk.loading')}</p>}
        {!loading && missing.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
            {t('scoring.desk.everyoneArrived')}
          </p>
        )}

        <div className="space-y-2">
          {missing.map((entry) => (
            <PersonRow
              key={entry.person.personId}
              person={entry.person}
              actions={
                <button
                  type="button"
                  onClick={() => onMark(entry.person.personId)}
                  className="min-h-[44px] rounded-lg bg-accent px-5 text-sm font-bold text-accent-foreground [touch-action:manipulation]"
                >
                  {t('scoring.desk.markArrived')}
                </button>
              }
            >
              <NextBout next={entry.next} />
            </PersonRow>
          ))}
        </div>
      </div>
    </main>
  );
}

/**
 * Where and when they are next due.
 *
 * Pool and piste are here because the organiser's next action after reading
 * this row is walking to that piste to warn the referee — a time alone does not
 * tell them where to go.
 */
function NextBout({ next }: { next: MissingFighter['next'] }) {
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

function formatTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
