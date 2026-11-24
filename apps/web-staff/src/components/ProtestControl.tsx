'use client';

/**
 * ProtestControl — one Fighter's protest button on the pad, and the penalty a
 * protest past the limit offers.
 *
 * The tap itself is not here: it is the pad's one protest tap (`useProtestTap`
 * in `MatchView`), shared with the round-break and result screens. This
 * component adds what only the pad does: the count after the tap
 * (`ProtestsSeen` names its race) and the offer, which the break screens never make.
 */

import { useEffect, useRef, useState } from 'react';
import { protestRulesOf, type TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import type { PenaltyCard, PenaltyRulesetEntry } from '../hooks/usePenalties';
import type { MatchScoringData } from '../hooks/useMatchScoringData';
import { cardWord } from '../lib/card-word';
import { protestsSeen, protestsShown, protestThenOffer } from '../lib/protest-offer';
import { protestsOf } from '../offline/pending-events';
import { AskFirstDialog } from './AskFirstDialog';
import { ProtestButton } from './ProtestButton';

interface ProtestControlProps {
  side: 'red' | 'blue';
  matchId: string;
  registrationId: string | null;
  fighterName: string;
  disabled: boolean;
  /** The pad's one protest tap: the `clientUuid` written, or null for a tap it ignored. */
  onProtestTap: (corner: 'red' | 'blue') => Promise<string | null>;
  config: TournamentScoringConfig;
  /** The Match's penalty list, where the organiser's penalty is found by its ref. */
  entries: readonly PenaltyRulesetEntry[];
  /** The pad takes a card now (`scoringEnabled`): the offer keeps to card entry. */
  cardEntryLive: boolean;
  scoring: MatchScoringData;
  /** The referee said yes to the offer: the column gives the card. */
  onOfferAccepted: (entry: PenaltyRulesetEntry) => void;
  /** The tablet could not keep the protest. */
  onTapFailed: () => void;
}

export function ProtestControl({
  side,
  matchId,
  registrationId,
  fighterName,
  disabled,
  onProtestTap,
  config,
  entries,
  cardEntryLive,
  scoring,
  onOfferAccepted,
  onTapFailed,
}: ProtestControlProps) {
  const { t } = useI18n();
  const protestRules = protestRulesOf(config.display);
  // The penalty a protest past the limit offers, and the card it would give, waiting for a yes.
  const [offered, setOffered] = useState<{
    entry: PenaltyRulesetEntry;
    card: PenaltyCard | undefined;
  } | null>(null);

  // The Fighter's protests the screen drew, and the ones written since (`ProtestsSeen` names the race).
  const seenProtests = useRef(protestsSeen(matchId));
  const shownKey = protestsOf({
    server: scoring.activeProtests,
    pending: scoring.pendingProtests,
    registrationId,
  })
    .map((row) => row.client_uuid)
    .join(' ');
  // A new bout on the same screen starts from nothing (`protestsShown` answers a fresh state).
  useEffect(() => {
    const shown = new Set(shownKey.split(' ').filter(Boolean));
    seenProtests.current = protestsShown(seenProtests.current, matchId, shown);
  }, [matchId, shownKey]);

  /**
   * A protest is recorded first; then, past the limit and while the pad takes
   * a card, the organiser's penalty is offered (`protestThenOffer`), on the
   * count after this tap. A tap ignored as a double tap offers nothing.
   */
  async function protest() {
    const entry = await protestThenOffer({
      tap: () => onProtestTap(side),
      seen: seenProtests.current,
      limit: protestRules.limit,
      offerPenaltyRef: protestRules.offerPenaltyRef,
      entries,
      cardEntryLive,
    });
    if (entry) setOffered({ entry, card: scoring.resolveCard(entry, registrationId) });
  }

  return (
    <>
      <ProtestButton
        count={scoring.protestCountFor(registrationId)}
        limit={protestRules.limit}
        fighterName={fighterName}
        disabled={disabled}
        onTap={() => void protest().catch(onTapFailed)}
        size="pad"
      />

      {/* The offer IS the confirmation: its yes gives the card, with no second question. */}
      <AskFirstDialog
        open={offered !== null}
        onClose={() => setOffered(null)}
        onConfirm={() => {
          const offer = offered;
          setOffered(null);
          if (offer) onOfferAccepted(offer.entry);
        }}
        title={t('scoring.lice.protestOfferTitle')}
        message={
          offered
            ? t('scoring.lice.protestOfferBody', {
                penalty: offered.entry.short_name,
                card: offered.card ? cardWord(offered.card, t) : '—',
                fighter: fighterName,
              })
            : ''
        }
        confirmLabel={t('scoring.lice.protestOfferConfirm')}
      />
    </>
  );
}
