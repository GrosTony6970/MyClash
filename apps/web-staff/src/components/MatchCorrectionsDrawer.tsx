'use client';

/**
 * MatchCorrectionsDrawer — right-side slide-over containing all the
 * less-frequent match correction tools. Replaces the always-visible
 * panel that used to dominate the scoreboard middle.
 *
 * Inside:
 *   - Swap fighter color / side
 *   - Time adjust (+/- seconds)
 *   - Exchange edit (select-from-list + "Edit as no exchange")
 *   - RESET MATCH (text-confirmation gate)
 *
 * "Clear last exchange" is NOT here — it lives inline in the centre
 * column so the operator doesn't have to open a drawer for the most
 * common correction action.
 */

import { useEffect, useMemo, useState } from 'react';
import type { TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { useScoringTheme } from '../theme/ThemeProvider';
import { clockAdjustmentMs } from './clock-adjustment';
import { refusalMessage, type RefusalBody } from '../lib/refusal-copy';
import { buildUnifiedTimeline, ConfirmDialog, exchangeOptionLabel } from '@myclash/ui';
import type { PenaltyCard } from '../hooks/usePenalties';
import type { MatchScoringData } from '../hooks/useMatchScoringData';
import { ForfeitPanel } from './ForfeitPanel';

const DIRECT_CARD_HEX: Record<PenaltyCard, string> = {
  yellow: '#eab308',
  red: '#dc2626',
  black: '#111827',
};
const DIRECT_CARD_LABEL: Record<PenaltyCard, string> = {
  yellow: 'Yellow',
  red: 'Red',
  black: 'Black',
};

interface MatchCorrectionsDrawerProps {
  open: boolean;
  onClose: () => void;
  matchId: string;
  apiUrl: string;
  online: boolean;
  locked: boolean;
  onDone: () => void;
  /** Display-anchored time adjust: the operator's add/subtract acts on the
   *  clock THEY see. Countdown inverts elapsed-vs-display, and a clock that
   *  ran past zero carries a hidden elapsed overshoot — the helper resolves
   *  both so "+10s at 0:00" lands the display on exactly 0:10. */
  timerMode: 'countdown' | 'countup';
  elapsedMs: number;
  limitMs: number | null;
  // Labelling context for the exchange picker — lets the drawer build the same
  // numbered timeline the centre history shows, so the `#`s match.
  redName: string;
  blueName: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  config: TournamentScoringConfig;
  /**
   * The match's events, read once by `MatchView`.
   *
   * This drawer is mounted unconditionally and returns null when shut — its
   * `if (!open)` guard sits BELOW the hooks — so the two reads it used to make
   * ran on every scored hit whether or not anyone had opened it.
   */
  scoring: MatchScoringData;
  /** Forfeit is only allowed while the match is running/paused and unlocked. */
  forfeitDisabled: boolean;
  /** Next penalty sequence + match-clock position — for direct cards. */
  nextSequence: number;
  clockTimeMs: number | null;
}

export function MatchCorrectionsDrawer({
  open,
  onClose,
  matchId,
  apiUrl,
  online,
  locked,
  onDone,
  timerMode,
  elapsedMs,
  limitMs,
  redName,
  blueName,
  redRegistrationId,
  blueRegistrationId,
  config,
  scoring,
  forfeitDisabled,
  nextSequence,
  clockTimeMs,
}: MatchCorrectionsDrawerProps) {
  const { t } = useI18n();
  const { chromeScope } = useScoringTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetText, setResetText] = useState('');
  const [reason, setReason] = useState('');
  const [adjustSeconds, setAdjustSeconds] = useState(10);
  const [selectedExchangeId, setSelectedExchangeId] = useState('');

  // SERVER rows, not the merged ones: the exchange picker offers rows the
  // correction endpoints can actually act on, and a queued hit has no server id
  // to void or edit.
  const { activeExchanges, activePenalties, ruleSetCards } = scoring;
  const [dcFighter, setDcFighter] = useState<'red' | 'blue'>('red');
  const [dcReason, setDcReason] = useState('');
  const [dcConfirm, setDcConfirm] = useState<PenaltyCard | null>(null);

  // The same numbered timeline as the centre history; the picker only offers
  // the exchange rows (its void/edit action is exchange-only), but their `#`
  // come from the shared sequence so they line up with the centre.
  const exchangeOptions = useMemo(
    () =>
      buildUnifiedTimeline({
        exchanges: activeExchanges,
        penalties: activePenalties,
        redName,
        blueName,
        redRegId: redRegistrationId,
        blueRegId: blueRegistrationId,
        t,
        config,
      }).filter((ev) => ev.kind === 'exchange'),
    [
      activeExchanges,
      activePenalties,
      redName,
      blueName,
      redRegistrationId,
      blueRegistrationId,
      t,
      config,
    ],
  );

  // Effective pick: honour the operator's choice while it's still in the list,
  // else default to the most-recent exchange (timeline is newest-first).
  const effectiveExchangeId =
    selectedExchangeId && exchangeOptions.some((ev) => ev.rawId === selectedExchangeId)
      ? selectedExchangeId
      : (exchangeOptions[0]?.rawId ?? '');

  // Escape closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const disabled = busy || !online || locked;

  async function post(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as RefusalBody;
        throw new Error(refusalMessage(res.status, payload, t, 'scoring.corrections.actionFailed'));
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scoring.corrections.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function editSelectedExchange() {
    if (!effectiveExchangeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/exchanges/${effectiveExchangeId}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason: reason || t('scoring.corrections.defaultReason'),
          clientUuid: crypto.randomUUID(),
          sequence: 0,
          type: 'no_exchange',
          occurredAt: new Date().toISOString(),
          noExchangeReason: 'other',
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as RefusalBody;
        throw new Error(refusalMessage(res.status, payload, t, 'scoring.corrections.actionFailed'));
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scoring.corrections.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function submitDirectCard(card: PenaltyCard) {
    const registrationId = dcFighter === 'red' ? redRegistrationId : blueRegistrationId;
    await post(`/api/v1/matches/${matchId}/penalties`, {
      clientUuid: crypto.randomUUID(),
      sequence: nextSequence,
      registrationId,
      occurredAt: new Date().toISOString(),
      clockTimeMs,
      directCard: card,
      reason: dcReason.trim(),
    });
    setDcReason('');
  }

  // Yellow issues directly; red/black go through the confirm dialog.
  function requestDirectCard(card: PenaltyCard) {
    if (card === 'yellow') void submitDirectCard('yellow');
    else setDcConfirm(card);
  }

  if (!open) return null;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss is a mouse convenience; keyboard close is the header button.
    <div className="fixed inset-0 z-sidebar flex justify-end bg-black/50" onClick={onClose}>
      {/* Own data-theme — part of the app's chrome (see MatchHeader). Tokens
          inherit from <body>, so the drawer needs its own scope or every
          semantic class here resolves to the pad's surface. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- stopPropagation keeps a click inside the drawer from closing it; not an interactive control. */}
      <aside
        data-theme={chromeScope}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface text-foreground shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <h2 className="text-base font-bold uppercase tracking-wide">
            {t('scoring.lice.matchActions')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-2 py-1 text-sm font-bold hover:bg-background"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {!online && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {t('scoring.corrections.onlineOnly')}
            </p>
          )}
          {locked && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {t('scoring.corrections.locked')}
            </p>
          )}
          {error && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          {/* Swap controls */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void post(`/api/v1/matches/${matchId}/swap-fighter-color`)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-background disabled:opacity-40"
            >
              {t('scoring.corrections.swapColor')}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void post(`/api/v1/matches/${matchId}/swap-fighter-side`)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-background disabled:opacity-40"
            >
              {t('scoring.corrections.swapSide')}
            </button>
          </div>

          {/* Time adjust */}
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
              {t('scoring.corrections.adjustSeconds')}
            </p>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input
                type="number"
                min={1}
                value={adjustSeconds}
                onChange={(e) => setAdjustSeconds(parseInt(e.target.value, 10) || 1)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
                aria-label={t('scoring.corrections.adjustSeconds')}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void post(`/api/v1/matches/${matchId}/clock/adjust`, {
                    adjustmentMs: clockAdjustmentMs({
                      timerMode,
                      direction: 'add',
                      seconds: adjustSeconds,
                      elapsedMs,
                      limitMs,
                    }),
                    reason: reason || t('scoring.corrections.defaultReason'),
                  })
                }
                className="rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-background disabled:opacity-40"
              >
                {t('scoring.corrections.addTime')}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void post(`/api/v1/matches/${matchId}/clock/adjust`, {
                    adjustmentMs: clockAdjustmentMs({
                      timerMode,
                      direction: 'subtract',
                      seconds: adjustSeconds,
                      elapsedMs,
                      limitMs,
                    }),
                    reason: reason || t('scoring.corrections.defaultReason'),
                  })
                }
                className="rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-background disabled:opacity-40"
              >
                {t('scoring.corrections.subtractTime')}
              </button>
            </div>
          </div>

          {/* Exchange editor */}
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">
              {t('scoring.corrections.selectExchange')}
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                value={effectiveExchangeId}
                onChange={(e) => setSelectedExchangeId(e.target.value)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="">{t('scoring.corrections.selectExchange')}</option>
                {exchangeOptions.map((ev) => (
                  <option key={ev.id} value={ev.rawId}>
                    {exchangeOptionLabel(ev)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={disabled || !effectiveExchangeId}
                onClick={() => void editSelectedExchange()}
                className="rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-background disabled:opacity-40"
              >
                {t('scoring.corrections.editAsNoExchange')}
              </button>
            </div>
          </div>

          {/* Correction reason */}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('scoring.corrections.reason')}
            aria-label={t('scoring.corrections.reason')}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />

          {/* Forfeit — consolidated here (no longer a bottom panel). */}
          <div className="border-t border-border pt-4">
            <ForfeitPanel
              matchId={matchId}
              apiUrl={apiUrl}
              redRegistrationId={redRegistrationId}
              blueRegistrationId={blueRegistrationId}
              redName={redName}
              blueName={blueName}
              disabled={forfeitDisabled}
              onForfeitRecorded={onDone}
            />
          </div>

          {/* Direct card — manual card issuance as chips (not solid bars). */}
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              {t('scoring.lice.directCardSection')}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('scoring.forfeits.fighter')}
                <select
                  value={dcFighter}
                  onChange={(e) => setDcFighter(e.target.value as 'red' | 'blue')}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                >
                  <option value="red">{redName}</option>
                  <option value="blue">{blueName}</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('scoring.lice.directCardReason')}
                <input
                  value={dcReason}
                  onChange={(e) => setDcReason(e.target.value)}
                  placeholder={t('scoring.lice.directCardReason')}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div
              className="mt-2 grid gap-2"
              style={{ gridTemplateColumns: `repeat(${ruleSetCards.length}, minmax(0, 1fr))` }}
            >
              {ruleSetCards.map((card) => (
                <button
                  key={card}
                  type="button"
                  disabled={disabled || dcReason.trim().length === 0}
                  onClick={() => requestDirectCard(card)}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border-2 bg-surface px-2 py-2 text-xs font-bold uppercase text-foreground hover:bg-background disabled:opacity-40"
                  style={{ borderColor: DIRECT_CARD_HEX[card] }}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: DIRECT_CARD_HEX[card] }}
                  />
                  {DIRECT_CARD_LABEL[card]}
                </button>
              ))}
            </div>
          </div>

          {/* Danger zone */}
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-danger">
              {t('scoring.corrections.resetMatch')}
            </p>
            <input
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              placeholder={t('scoring.corrections.resetConfirmation')}
              aria-label={t('scoring.corrections.resetConfirmation')}
              className="mb-2 w-full rounded-lg border border-danger/50 bg-surface px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={disabled || resetText !== 'RESET MATCH'}
              onClick={() =>
                void post(`/api/v1/matches/${matchId}/reset`, {
                  confirmation: resetText,
                  reason: reason || t('scoring.corrections.defaultReason'),
                })
              }
              className="w-full rounded-lg border border-danger bg-danger px-3 py-2 text-sm font-bold text-danger-foreground hover:bg-danger-hover disabled:opacity-40"
            >
              {t('scoring.corrections.resetMatch')}
            </button>
          </div>
        </div>

        <ConfirmDialog
          open={dcConfirm !== null}
          onConfirm={() => {
            const card = dcConfirm;
            setDcConfirm(null);
            if (card) void submitDirectCard(card);
          }}
          onCancel={() => setDcConfirm(null)}
          title={t('scoring.lice.directCardConfirmTitle')}
          description={t('scoring.lice.directCardConfirmBody', {
            fighter: dcFighter === 'red' ? redName : blueName,
          })}
          confirmLabel={t('scoring.lice.directCardConfirm')}
          cancelLabel={t('common.cancel')}
          danger
        />
      </aside>
    </div>
  );
}
