'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import {
  MAX_RECIPIENTS,
  hiddenPicked,
  shownPeople,
  withShown,
  type Recipient,
} from '../recipients';

/**
 * "Specific persons" of a broadcast (O5, ruled 2026-10-14): a search over name, email and club,
 * accents ignored; "Select all shown" adds the shown people to the ones picked; "Clear" empties
 * the pick; the count holds the picked people the search hides; above 500 the picker says so.
 */
export function RecipientPicker({
  people,
  picked,
  onPick,
}: {
  people: Recipient[];
  picked: ReadonlySet<string>;
  onPick: (next: Set<string>) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const shown = shownPeople(people, search);
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onPick(next);
  };

  return (
    <div className="mb-5 rounded-lg border border-border p-3">
      <label className="mb-2 block text-sm font-medium text-foreground-secondary">
        {t('organizer.broadcast.people')}
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('organizer.broadcast.searchPeople')}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal"
        />
      </label>
      <PickActions shown={shown} picked={picked} onPick={onPick} />
      <RecipientRows shown={shown} picked={picked} onToggle={toggle} />
    </div>
  );
}

/** Select all shown, Clear, the count, and the line above the server's limit. */
function PickActions({
  shown,
  picked,
  onPick,
}: {
  shown: Recipient[];
  picked: ReadonlySet<string>;
  onPick: (next: Set<string>) => void;
}) {
  const { t } = useI18n();
  const hidden = hiddenPicked(picked, shown);
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => onPick(withShown(picked, shown))}
          className="font-medium text-accent"
        >
          {t('organizer.broadcast.selectAllShown')}
        </button>
        <button
          type="button"
          onClick={() => onPick(new Set())}
          className="font-medium text-foreground-secondary"
        >
          {t('organizer.broadcast.clearPicked')}
        </button>
        <span className="text-muted" role="status">
          {hidden > 0
            ? t('organizer.broadcast.pickedHidden', { count: picked.size, hidden })
            : t('organizer.broadcast.picked', { count: picked.size })}
        </span>
      </div>
      {picked.size > MAX_RECIPIENTS && (
        <p className="mb-2 text-sm text-danger" role="alert">
          {t('organizer.broadcast.tooMany', { max: MAX_RECIPIENTS, count: picked.size })}
        </p>
      )}
    </>
  );
}

function RecipientRows({
  shown,
  picked,
  onToggle,
}: {
  shown: Recipient[];
  picked: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  if (shown.length === 0) {
    return <p className="text-sm text-muted">{t('organizer.broadcast.emptyPeople')}</p>;
  }
  return (
    <div className="max-h-52 overflow-auto">
      {shown.map((person) => (
        <label key={person.id} className="flex items-center gap-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={picked.has(person.id)}
            onChange={() => onToggle(person.id)}
          />
          <span>
            <span className="font-medium">
              {person.givenName} {person.familyName}
            </span>
            {person.clubLabel && (
              <span className="ml-2 text-foreground-secondary">{person.clubLabel}</span>
            )}
            <span className="ml-2 text-muted">{person.email}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
