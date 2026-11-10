'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { joinEvent, type JoinNames } from './join-event';

const BOX =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-50';

/**
 * A signed-in account not on the list, at an Event that lets people join by themselves (rulings
 * 516, 568): one tap puts it on the list, then books the session it tapped (`onJoined`). The name
 * is the profile's, so no box shows; the server asks for one (`NamesRequired`) only when the
 * account has none, and the two boxes appear then. The page never shows a name the server would
 * not write.
 */
export function JoinEventPanel({
  apiUrl,
  eventId,
  onJoined,
}: {
  apiUrl: string;
  eventId: string;
  onJoined: () => Promise<void>;
}): ReactNode {
  const { t } = useI18n();
  const { askNames, names, setNames, busy, refusal, submit } = useJoin(apiUrl, eventId, onJoined);
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="rounded-xl border border-border bg-surface px-4 py-3 text-sm"
    >
      <p className="font-semibold text-foreground">{t('publicApp.workshopDetail.join.title')}</p>
      <p className="mt-1 text-foreground-secondary">
        {t(
          askNames
            ? 'publicApp.workshopDetail.join.namesLead'
            : 'publicApp.workshopDetail.join.lead',
        )}
      </p>
      {askNames && <NameBoxes names={names} setNames={setNames} disabled={busy} />}
      {refusal && (
        <p role="alert" className="mt-2 text-danger">
          {refusal}
        </p>
      )}
      <Button type="submit" disabled={busy} className="mt-3 min-h-11">
        {t(busy ? 'publicApp.workshopDetail.join.busy' : 'publicApp.workshopDetail.join.button')}
      </Button>
    </form>
  );
}

/** The join's state: one tap, the names box only once the server asks, the refusal in words. */
function useJoin(apiUrl: string, eventId: string, onJoined: () => Promise<void>) {
  const { t } = useI18n();
  const [askNames, setAskNames] = useState(false);
  const [names, setNames] = useState<JoinNames>({ givenName: '', familyName: '' });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setRefusal(null);
    try {
      const result = await joinEvent(apiUrl, eventId, askNames ? names : null, t);
      if (result.ok) await onJoined();
      else if ('names' in result) setAskNames(true);
      else setRefusal(result.words);
    } finally {
      setBusy(false);
    }
  }

  return { askNames, names, setNames, busy, refusal, submit };
}

function NameBoxes({
  names,
  setNames,
  disabled,
}: {
  names: JoinNames;
  setNames: (update: (n: JoinNames) => JoinNames) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <NameBox
        label={t('publicApp.workshopDetail.join.givenName')}
        value={names.givenName}
        disabled={disabled}
        onChange={(givenName) => setNames((n) => ({ ...n, givenName }))}
      />
      <NameBox
        label={t('publicApp.workshopDetail.join.familyName')}
        value={names.familyName}
        disabled={disabled}
        onChange={(familyName) => setNames((n) => ({ ...n, familyName }))}
      />
    </div>
  );
}

function NameBox({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      <input
        required
        maxLength={100}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={BOX}
      />
    </label>
  );
}
