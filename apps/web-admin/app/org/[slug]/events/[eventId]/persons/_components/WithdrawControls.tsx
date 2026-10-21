'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest, failureCode, type ApiFailure } from '@myclash/api-client';
import { useToast, type ConfirmOptions } from '@myclash/ui';
import { correctionFailureMessage } from '@/lib/correction-refusal';

/** The organiser's hand on an entry (`entry_status`), as the roster read hands it over. */
export type EntryStatus = 'registered' | 'checked_in' | 'withdrawn' | 'waitlist';

interface Props {
  apiUrl: string;
  registrationId: string;
  entryStatus: EntryStatus;
  fighterName: string;
  tournamentName: string;
  readOnly: boolean;
  /** The page's one confirm dialog. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** The roster is read again: her status, and whatever else the change moved. */
  onChanged: () => void;
}

/** A refusal of this door, in the reader's language: a full Tournament, a changed entry, else the usual. */
function refusalOf(
  failure: ApiFailure,
  t: (key: string, vars?: Record<string, string>) => string,
  tournament: string,
): string | null {
  if (failure.kind === 'http' && failure.details?.['reason'] === 'tournament_full') {
    return t('organizer.persons.withdraw.full', { tournament });
  }
  if (failureCode(failure) === 'entry_status_changed')
    return t('organizer.persons.withdraw.changed');
  return correctionFailureMessage(failure, t, t('organizer.persons.withdraw.failed'));
}

/** The PATCH of the entry's hand, its toast, and the roster read again. */
function useHandChange(props: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const vars = { name: props.fighterName, tournament: props.tournamentName };

  async function change(status: 'withdrawn' | 'registered') {
    setBusy(true);
    const path = `/api/v1/registrations/${props.registrationId}/status`;
    const r = await apiRequest(props.apiUrl, path, { method: 'PATCH', body: { status } });
    setBusy(false);
    if (r.ok) {
      const done =
        status === 'withdrawn'
          ? t('organizer.persons.withdraw.withdrawn', vars)
          : t('organizer.persons.withdraw.undone', vars);
      toast.success(done);
      props.onChanged();
      return;
    }
    const message = refusalOf(r, t, props.tournamentName);
    if (message) toast.error(message);
    if (failureCode(r) === 'entry_status_changed') props.onChanged();
  }

  async function withdraw() {
    const sure = await props.confirm({
      title: t('organizer.persons.withdraw.confirmTitle', vars),
      description: t('organizer.persons.withdraw.confirmBody'),
      confirmLabel: t('organizer.persons.withdraw.confirm'),
      cancelLabel: t('actions.cancel'),
      danger: true,
    });
    if (sure) await change('withdrawn');
  }

  return { t, busy, change, withdraw };
}

const BUTTON = 'text-xs hover:underline disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Withdraw a Fighter by hand, and undo it (rulings 110, 111): beside the entry, on the roster's
 * tab of one Tournament (ruling 115). A withdrawal forfeits her remaining Pool bouts, so it asks
 * first; its undo brings them back and puts her in as registered, to be checked in again. A
 * Fighter a forfeit or a card put out keeps her entry's hand: Withdraw still shows, and keeps her
 * out once that cause is voided.
 */
export function WithdrawControls(props: Props) {
  const { t, busy, change, withdraw } = useHandChange(props);
  if (props.entryStatus === 'waitlist') return null;
  const undo = props.entryStatus === 'withdrawn';
  return (
    <button
      type="button"
      onClick={() => void (undo ? change('registered') : withdraw())}
      disabled={busy || props.readOnly}
      className={`${BUTTON} ${undo ? 'text-info' : 'text-danger'}`}
    >
      {undo ? t('organizer.persons.withdraw.undo') : t('organizer.persons.withdraw.withdraw')}
    </button>
  );
}
