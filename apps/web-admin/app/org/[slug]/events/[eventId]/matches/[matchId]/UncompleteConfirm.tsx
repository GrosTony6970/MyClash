'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Modal } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import {
  uncompleteConfirmCopy,
  type CopyLine,
  type UncompleteConfirmCopy,
  type UncompletePreflight,
} from './uncomplete-confirm-copy';

/**
 * What undoing a result costs, shown BEFORE the organiser commits to it.
 *
 * Two surfaces, one source of truth. The hint sits on the panel so the
 * consequence is readable without opening anything — the pattern
 * `voidConfirmCopy` established, for the same reason: an organiser decides
 * whether to click by looking at the panel, not by reading a dialog they have
 * not opened yet. The dialog then states every consequence in full, and only
 * arms the button once the tick is on.
 *
 * The API refuses independently. This is not the enforcement point — the
 * capability is checked server-side and a missing tick is a 409 either way —
 * it is the difference between an operator who understands the refusal and one
 * who hits it.
 */

function usePreflight(matchId: string, refreshToken: number): UncompletePreflight | null {
  const [preflight, setPreflight] = useState<UncompletePreflight | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      // Silence beats a false all-clear: a panel that cannot load shows nothing,
      // and the copy builder degrades to the generic sentence.
      const r = await apiRequest<UncompletePreflight>(
        getPublicApiUrl(),
        `/api/v1/matches/${matchId}/uncomplete-preflight`,
        { signal },
      );
      if (r.ok) {
        setPreflight(r.data);
        return;
      }
      // A refusal leaves whatever is on screen; only a dropped connection or an
      // unreadable body clears it, and an abort is a newer load's business.
      if (r.kind === 'network') setPreflight(null);
    },
    [matchId],
  );

  // Deferred off the effect body — setState inside one cascades renders and the
  // repo lints it at max-warnings 0.
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => {
      controller.abort();
    };
  }, [load, refreshToken]);

  return preflight;
}

/** The persistent panel line. Null when there is nothing extra to say. */
export function UncompleteHint({
  matchId,
  refreshToken,
}: {
  matchId: string;
  refreshToken: number;
}) {
  const { t } = useI18n();
  const preflight = usePreflight(matchId, refreshToken);
  const copy = uncompleteConfirmCopy(preflight);
  if (!preflight || !copy.hint) return null;

  return (
    <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3">
      <p className="text-sm font-semibold text-danger">
        {t('organizer.matchDetail.uncompleteBlockedTitle')}
      </p>
      <p className="mt-1 text-xs text-muted">{t(copy.hint.key, copy.hint.values)}</p>
      {preflight.affected.some((bout) => bout.hasBeenFought) && (
        <>
          <p className="mt-2 text-xs font-semibold text-foreground-secondary">
            {t('organizer.matchDetail.uncompleteAffectedTitle')}
          </p>
          <ul className="mt-1 space-y-0.5">
            {preflight.affected
              .filter((bout) => bout.hasBeenFought)
              .map((bout) => (
                <li
                  key={`${bout.label ?? ''}-${bout.round}-${bout.redName ?? ''}`}
                  className="text-xs text-foreground-secondary"
                >
                  {/* Names, never ids — the organiser has to recognise the bout. */}
                  <span className="font-semibold">{bout.label ?? `R${bout.round}`}</span>{' '}
                  {bout.redName} — {bout.blueName}
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The dialog. `onConfirm` receives whether the organiser armed the discard, so
 * the caller passes it straight through as `discardDependentResults`.
 */
interface UncompleteDialogProps {
  matchId: string;
  open: boolean;
  refreshToken: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (discardDependentResults: boolean) => void;
}

export function UncompleteDialog({
  matchId,
  open,
  refreshToken,
  busy = false,
  onCancel,
  onConfirm,
}: UncompleteDialogProps) {
  const { t } = useI18n();
  const preflight = usePreflight(matchId, refreshToken);
  const copy = uncompleteConfirmCopy(preflight);
  // Fresh every time the dialog opens, because the caller remounts it on `open`
  // rather than resetting this from an effect — the repo lints
  // set-state-in-effect at max-warnings 0, and a remount is the honest way to
  // say "this is a new decision" anyway.
  const [acknowledged, setAcknowledged] = useState(false);

  const armed = copy.action === 'proceed' || (copy.action === 'acknowledge' && acknowledged);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      busy={busy}
      title={t('organizer.matchDetail.uncompleteTitle')}
      footer={
        <DialogFooter
          action={copy.action}
          armed={armed}
          busy={busy}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      }
    >
      <DialogBody copy={copy} acknowledged={acknowledged} onAcknowledge={setAcknowledged} />
    </Modal>
  );
}

/** Refused hides the action entirely — offering a button that cannot work is worse than none. */
function DialogFooter({
  action,
  armed,
  busy,
  onCancel,
  onConfirm,
}: {
  action: UncompleteConfirmCopy['action'];
  armed: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (discardDependentResults: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        {t('actions.cancel')}
      </Button>
      {action !== 'refused' && (
        <Button
          variant="danger"
          disabled={!armed || busy}
          onClick={() => onConfirm(action === 'acknowledge')}
        >
          {t('organizer.matchDetail.uncompleteConfirm')}
        </Button>
      )}
    </div>
  );
}

/** Every consequence, then the tick that arms the action when there is one. */
function DialogBody({
  copy,
  acknowledged,
  onAcknowledge,
}: {
  copy: UncompleteConfirmCopy;
  acknowledged: boolean;
  onAcknowledge: (next: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      {copy.body.map((item: CopyLine) => (
        <p key={item.key} className="text-sm text-foreground-secondary">
          {t(item.key, item.values)}
        </p>
      ))}
      {copy.action === 'acknowledge' && (
        <label className="mt-2 flex items-start gap-2 text-sm text-danger">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            onChange={(event) => onAcknowledge(event.target.checked)}
          />
          <span>{t('organizer.matchDetail.uncompleteAcknowledge')}</span>
        </label>
      )}
    </div>
  );
}
