'use client';

/**
 * DirectCardPanel — a card the referee gives by hand, from the corrections drawer.
 *
 * It goes through the queue like a card of the penalty list (rulings 313, 314):
 * on the tablet first, the drawer closes, the queue sends it. So it works with
 * no connection, and it is the one part of the drawer that does.
 */

import { useState } from 'react';
import { ConfirmDialog } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import type { PenaltyCard } from '../hooks/usePenalties';
import { cardAsksFirst } from '../lib/card-asks-first';
import { cardWord } from '../lib/card-word';
import { giveDirectCard } from '../lib/direct-card';
import type { BoutNames } from '../offline/db';
import type { SyncEngine } from '../offline/sync';

const DIRECT_CARD_HEX: Record<PenaltyCard, string> = {
  yellow: '#eab308',
  red: '#dc2626',
  black: '#111827',
};

type Corner = 'red' | 'blue';
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * What the referee has typed so far. The drawer keeps it: this panel leaves the
 * page each time the drawer shuts, and a stray tap must not lose a typed reason.
 */
export interface DirectCardDraft {
  fighter: Corner;
  reason: string;
}

export const NO_DIRECT_CARD_DRAFT: DirectCardDraft = { fighter: 'red', reason: '' };

/** The server takes a reason of this length at most (`createPenaltySchema`). */
const REASON_MAX_LENGTH = 500;

export interface DirectCardPanelProps {
  draft: DirectCardDraft;
  onDraft: (draft: DirectCardDraft) => void;
  matchId: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  redName: string;
  blueName: string;
  ruleSetCards: readonly PenaltyCard[];
  /** Next sequence + match-clock position, as a card of the list carries them. */
  nextSequence: number;
  clockTimeMs: number | null;
  /** The bout in words: a held card's row is read out from them (ruling 243). */
  bout: BoutNames;
  syncEngine?: SyncEngine | null | undefined;
  /** For the line that says a card is kept (ruling 315). It greys nothing here. */
  online: boolean;
  disabled: boolean;
  onClose: () => void;
  onRecorded: () => void;
}

/** Who the card is against, and why: the server wants a reason for a direct card. */
function CardFields({
  draft,
  onDraft,
  redName,
  blueName,
  t,
}: Pick<DirectCardPanelProps, 'draft' | 'onDraft' | 'redName' | 'blueName'> & { t: Translate }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted">
        {t('scoring.forfeits.fighter')}
        <select
          value={draft.fighter}
          onChange={(e) => onDraft({ ...draft, fighter: e.target.value as Corner })}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="red">{redName}</option>
          <option value="blue">{blueName}</option>
        </select>
      </label>
      <label className="text-xs font-semibold uppercase tracking-wide text-muted">
        {t('scoring.lice.directCardReason')}
        <input
          data-testid="direct-card-reason"
          maxLength={REASON_MAX_LENGTH}
          value={draft.reason}
          onChange={(e) => onDraft({ ...draft, reason: e.target.value })}
          placeholder={t('scoring.lice.directCardReason')}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}

/** One chip per card colour of the ruleset (chips, not solid bars). */
function CardChips({
  cards,
  disabled,
  onPick,
  t,
}: {
  cards: readonly PenaltyCard[];
  disabled: boolean;
  onPick: (card: PenaltyCard) => void;
  t: Translate;
}) {
  return (
    <div
      className="mt-2 grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}
    >
      {cards.map((card) => (
        <button
          key={card}
          type="button"
          data-testid="direct-card-button"
          data-card={card}
          disabled={disabled}
          onClick={() => onPick(card)}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg border-2 bg-surface px-2 py-2 text-xs font-bold uppercase text-foreground hover:bg-background disabled:opacity-40"
          style={{ borderColor: DIRECT_CARD_HEX[card] }}
        >
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: DIRECT_CARD_HEX[card] }}
          />
          {cardWord(card, t)}
        </button>
      ))}
    </div>
  );
}

/** The giving of one card: the order is `giveDirectCard`'s, the steps are this panel's. */
function useDirectCard(props: DirectCardPanelProps, t: Translate) {
  const { draft, onDraft } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function give(card: PenaltyCard) {
    setBusy(true);
    setError(null);
    try {
      await giveDirectCard(directCardRow(props, card), {
        notKept: () => setError(t('scoring.corrections.actionFailed')),
        close: () => {
          onDraft({ ...draft, reason: '' });
          props.onClose();
        },
        send: () => props.syncEngine?.sendBehind(),
        recorded: props.onRecorded,
      });
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, give };
}

export function DirectCardPanel(props: DirectCardPanelProps) {
  const { redName, blueName, online, disabled, draft, onDraft } = props;
  const { fighter, reason } = draft;
  const { t } = useI18n();
  const { busy, error, give } = useDirectCard(props, t);
  const [confirm, setConfirm] = useState<PenaltyCard | null>(null);

  return (
    <div className="border-t border-border pt-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
        {t('scoring.lice.directCardSection')}
      </p>
      {!online && <p className="mb-2 text-xs text-muted">{t('scoring.lice.directCardOffline')}</p>}
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <CardFields draft={draft} onDraft={onDraft} redName={redName} blueName={blueName} t={t} />
      <CardChips
        cards={props.ruleSetCards}
        disabled={disabled || busy || reason.trim().length === 0}
        // Yellow is given at the tap; red and black ask first.
        onPick={(card) => (cardAsksFirst(card) ? setConfirm(card) : void give(card))}
        t={t}
      />
      <ConfirmDialog
        open={confirm !== null}
        onConfirm={() => {
          const card = confirm;
          setConfirm(null);
          if (card) void give(card);
        }}
        onCancel={() => setConfirm(null)}
        title={t('scoring.lice.directCardConfirmTitle')}
        description={t('scoring.lice.directCardConfirmBody', {
          fighter: fighter === 'red' ? redName : blueName,
        })}
        confirmLabel={t('scoring.lice.directCardConfirm')}
        cancelLabel={t('common.cancel')}
        danger
      />
    </div>
  );
}

/** The card as the queue keeps it: the model is a card of the list (`ScoringColumn`). */
function directCardRow(props: DirectCardPanelProps, card: PenaltyCard) {
  const { fighter, reason } = props.draft;
  return {
    matchId: props.matchId,
    sequence: props.nextSequence,
    registrationId: fighter === 'red' ? props.redRegistrationId : props.blueRegistrationId,
    clockTimeMs: props.clockTimeMs,
    bout: props.bout,
    cardedColor: fighter,
    directCard: card,
    reason: reason.trim(),
  };
}
