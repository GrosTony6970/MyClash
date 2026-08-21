'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { apiRequest } from '@myclash/api-client';
import { refusalMessage } from '../lib/refusal-copy';

type ForfeitReason = 'injury' | 'voluntary' | 'black_card_1' | 'black_card_2' | 'conduct_violation';
type FighterColor = 'red' | 'blue';

export interface ForfeitPanelProps {
  matchId: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  redName: string;
  blueName: string;
  apiUrl?: string;
  disabled?: boolean;
  onForfeitRecorded?: () => void;
}

const REASONS: ForfeitReason[] = [
  'injury',
  'voluntary',
  'black_card_1',
  'black_card_2',
  'conduct_violation',
];

const ASK_CONTINUE = new Set<ForfeitReason>(['injury', 'voluntary', 'black_card_1']);

export function ForfeitPanel({
  matchId,
  redRegistrationId,
  blueRegistrationId,
  redName,
  blueName,
  apiUrl = 'http://localhost:4000',
  disabled = false,
  onForfeitRecorded,
}: ForfeitPanelProps) {
  const { t } = useI18n();
  const [fighter, setFighter] = useState<FighterColor>('red');
  const [reason, setReason] = useState<ForfeitReason>('injury');
  const [canContinue, setCanContinue] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fighterId = `forfeit-fighter-${matchId}`;
  const reasonId = `forfeit-reason-${matchId}`;
  const noteId = `forfeit-note-${matchId}`;
  const canContinueId = `forfeit-can-continue-${matchId}`;

  async function submit() {
    setSubmitting(true);
    setError(null);
    const result = await apiRequest(apiUrl, `/api/v1/matches/${matchId}/forfeit`, {
      method: 'POST',
      body: {
        forfeitingRegistrationId: fighter === 'red' ? redRegistrationId : blueRegistrationId,
        reason,
        canContinue: ASK_CONTINUE.has(reason) ? canContinue : undefined,
        note: note.trim() || undefined,
      },
    });
    setSubmitting(false);

    if (result.ok) {
      setNote('');
      onForfeitRecorded?.();
      return;
    }
    const message = refusalMessage(result, t, 'scoring.forfeits.recordError');
    if (message) setError(message);
  }

  const forfeitingName = fighter === 'red' ? redName : blueName;

  return (
    <section className="text-foreground">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
        {t('scoring.forfeits.title')}
      </h3>
      {error && (
        <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label
          htmlFor={fighterId}
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {t('scoring.forfeits.fighter')}
          <select
            id={fighterId}
            value={fighter}
            onChange={(event) => setFighter(event.target.value as FighterColor)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          >
            <option value="red">{redName}</option>
            <option value="blue">{blueName}</option>
          </select>
        </label>
        <label
          htmlFor={reasonId}
          className="text-xs font-semibold uppercase tracking-wide text-muted"
        >
          {t('scoring.forfeits.reason')}
          <select
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value as ForfeitReason)}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          >
            {REASONS.map((item) => (
              <option key={item} value={item}>
                {t(`scoring.forfeits.reasons.${item}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {ASK_CONTINUE.has(reason) && (
        <label
          htmlFor={canContinueId}
          className="mt-3 flex items-center gap-2 text-sm text-foreground-secondary"
        >
          <input
            id={canContinueId}
            aria-label={t('scoring.forfeits.canContinue')}
            type="checkbox"
            checked={canContinue}
            onChange={(event) => setCanContinue(event.target.checked)}
          />
          {t('scoring.forfeits.canContinue')}
        </label>
      )}
      <input
        id={noteId}
        aria-label={t('scoring.forfeits.note')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t('scoring.forfeits.note')}
        className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
      />
      {/* Neutral trigger — the danger-red only appears on the confirm step (P0-2/P0-3). */}
      <button
        type="button"
        disabled={disabled || submitting}
        onClick={() => setConfirmOpen(true)}
        className="mt-3 w-full rounded-lg bg-strong px-4 py-2 text-sm font-bold text-strong-foreground hover:bg-strong-hover disabled:opacity-40"
      >
        {submitting ? t('scoring.forfeits.recording') : t('scoring.forfeits.record')}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        onConfirm={() => {
          setConfirmOpen(false);
          void submit();
        }}
        onCancel={() => setConfirmOpen(false)}
        title={t('scoring.forfeits.confirmTitle')}
        description={t('scoring.forfeits.confirmBody', { fighter: forfeitingName })}
        confirmLabel={t('scoring.forfeits.record')}
        cancelLabel={t('common.cancel')}
        busy={submitting}
        danger
      />
    </section>
  );
}
