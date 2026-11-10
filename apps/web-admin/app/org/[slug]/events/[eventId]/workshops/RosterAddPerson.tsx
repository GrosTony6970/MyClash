'use client';

import { Button, FormField } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import {
  personName,
  rosterAddCandidates,
  rosterAddedWords,
  useRosterAdd,
  type RosterAddOutcome,
  type RosterAddTarget,
} from './roster-add';

/**
 * "Add a person" under a session's roster (operator rulings 535, 536). The page shows it for a
 * session that runs; on an archived Event it is greyed, as Remove is. While the roster is read
 * (first read or after a write) the people offered wait: the list that hides the ones already
 * booked is not the session's yet.
 */
export function RosterAddPerson({
  readOnly,
  rereading,
  onRoster,
  ...target
}: RosterAddTarget & { readOnly: boolean; rereading: boolean; onRoster: ReadonlySet<string> }) {
  const { t } = useI18n();
  const box = useRosterAdd(target);
  const archived = readOnly ? t('organizer.deletionRequest.archivedReadOnly') : undefined;

  if (!box.open) {
    return (
      <div className="mt-4 border-t border-border pt-4">
        <Button
          size="sm"
          variant="secondary"
          disabled={readOnly}
          title={archived}
          onClick={() => void box.start()}
        >
          {t('organizer.workshopsPage.add.open')}
        </Button>
        <OutcomeLine outcome={box.outcome} />
      </div>
    );
  }

  return (
    <section className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
      <FormField
        type="search"
        label={t('organizer.workshopsPage.add.searchLabel')}
        value={box.query}
        onChange={(e) => box.setQuery(e.target.value)}
      />
      {box.peopleError && (
        <p role="alert" className="text-sm text-danger">
          {box.peopleError}
        </p>
      )}
      <Candidates
        box={box}
        onRoster={onRoster}
        disabled={readOnly || rereading || box.busy}
        title={archived}
      />
      <OutcomeLine outcome={box.outcome} />
    </section>
  );
}

/** The Event's people who match the search, each a button that books them. */
function Candidates({
  box,
  onRoster,
  disabled,
  title,
}: {
  box: ReturnType<typeof useRosterAdd>;
  onRoster: ReadonlySet<string>;
  disabled: boolean;
  title: string | undefined;
}) {
  const { t } = useI18n();
  const candidates = rosterAddCandidates(box.people ?? [], onRoster, box.query);
  if (box.query.trim() && box.people && candidates.length === 0) {
    return <p className="text-sm text-muted">{t('organizer.workshopsPage.add.noMatch')}</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {candidates.map((person) => (
        <li key={person.id}>
          <button
            type="button"
            disabled={disabled}
            title={title}
            onClick={() => void box.add(person)}
            className="w-full rounded border border-border px-3 py-1.5 text-left text-sm hover:bg-background disabled:opacity-50"
          >
            {personName(person)}
            {person.clubLabel && (
              <span className="ml-2 text-xs text-muted">{person.clubLabel}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What became of the last add: a status a screen reader says, or an alert. */
function OutcomeLine({ outcome }: { outcome: RosterAddOutcome }) {
  const { t } = useI18n();
  if (!outcome) return null;
  if ('error' in outcome) {
    return (
      <p role="alert" className="text-sm text-danger">
        {outcome.error}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-success">
      {rosterAddedWords(outcome, t)}
    </p>
  );
}
