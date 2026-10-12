'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { resetPhraseTyped } from '../lib/reset-phrase';

interface ResetMatchZoneProps {
  /** The drawer cannot act: a request is out, no network, or the bout is locked. */
  disabled: boolean;
  /** Reset the bout. True when the server took it. */
  onReset: () => Promise<boolean>;
}

/**
 * The danger zone of the corrections drawer: the bout is reset once the
 * official has typed the two words (quick win P9).
 *
 * Its own component for its state. The drawer is mounted all the time and
 * draws nothing while it is shut, so the words typed lived as long as the bout
 * screen: after a reset, "RESET MATCH" was still in the field and the button
 * was armed the next time the drawer opened. Drawn by the open drawer only,
 * this zone starts empty at each opening; it is emptied after a reset too,
 * because the drawer may stay open.
 */
export function ResetMatchZone({ disabled, onReset }: ResetMatchZoneProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const ready = resetPhraseTyped(typed);

  async function reset() {
    if (await onReset()) setTyped('');
  }

  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-danger">
        {t('scoring.corrections.resetMatch')}
      </p>
      <input
        data-testid="reset-phrase"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={t('scoring.corrections.resetConfirmation')}
        aria-label={t('scoring.corrections.resetConfirmation')}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="mb-2 min-h-[44px] w-full rounded-lg border border-danger/50 bg-surface px-3 py-2 text-sm"
      />
      {!ready && (
        <p data-testid="reset-phrase-missing" className="mb-2 text-sm text-foreground-secondary">
          {t('scoring.corrections.resetPhraseMissing')}
        </p>
      )}
      <button
        type="button"
        data-testid="reset-match"
        disabled={disabled || !ready}
        onClick={() => void reset()}
        className="min-h-[44px] w-full rounded-lg border border-danger bg-danger px-3 py-2 text-sm font-bold text-danger-foreground hover:bg-danger-hover disabled:opacity-40"
      >
        {t('scoring.corrections.resetMatch')}
      </button>
    </div>
  );
}
