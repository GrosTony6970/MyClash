'use client';

import { useRef, useState } from 'react';
import {
  BracketView,
  CollapsibleSection,
  asColorToken,
  extractBronzeMatch,
  type BracketSlotData,
} from '@myclash/ui';
import type { TournamentScoringConfig } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';
import { useLazyFetch } from '../../../../src/hooks/useLazyFetch';
import { useScrollToBracketSlot } from '../../../../src/hooks/useScrollToBracketSlot';
import { buildLiceBracketFocus } from '../../../../src/components/lice-pool-focus';
import type { TournamentBracketPayload } from '../../../../src/components/tournament-context-types';
import { ContextStatus } from './ContextStatus';

/** The tree itself, in its own horizontal scroller. */
function BracketTree({
  bracket,
  slots,
  liceId,
  scoringConfig,
  weapon,
  scrollerRef,
  t,
}: {
  bracket: TournamentBracketPayload;
  slots: BracketSlotData[];
  liceId: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  scoringConfig: TournamentScoringConfig | null;
  weapon: string | null;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Mandatory before rendering: without it the bronze match and the final
  // collapse onto the same card.
  const { bronze, mainSlots } = extractBronzeMatch(slots);
  const sideColors = scoringConfig?.display?.sideColors;
  return (
    // MatchCard paints itself white with slate text, so the tree is pinned to
    // the light scope rather than re-themed — re-theming it would reach into
    // the admin and public brackets too.
    <div ref={scrollerRef} data-theme="light" className="overflow-x-auto rounded-xl bg-white p-3">
      <BracketView
        slots={mainSlots}
        bronzeMatch={bronze}
        rounds={bracket.rounds}
        bracketSize={bracket.bracketSize}
        weapon={weapon}
        bracketConfig={{
          phaseType: bracket.phaseType,
          wbRounds: bracket.wbRounds ?? undefined,
          lbRounds: bracket.lbRounds ?? undefined,
        }}
        // asColorToken, not a cast: a tournament may be configured grey, brown
        // or pink, none of which is a ColorToken.
        redColor={asColorToken(sideColors?.red ?? 'red')}
        blueColor={asColorToken(sideColors?.blue ?? 'blue')}
        highlightLiceId={liceId}
        showReferees
        t={t}
      />
    </div>
  );
}

/**
 * The whole bracket, with this piste's matches ringed and scrolled into view.
 *
 * `BracketView` is the real draw the organizer sees — wide and horizontally
 * scrolling. Reproducing it as a list would be a second renderer to keep in
 * step with the first.
 *
 * `showReferees` is on here and nowhere else: the piste screen is the one
 * surface where "who calls this bout" is an operational question. BracketView
 * widens its vertical pitch to fit the band, so the connectors still land on
 * the cards.
 */
export function BracketDisclosure({
  apiUrl,
  liceId,
  tournamentId,
  scoringConfig,
  weapon,
}: {
  apiUrl: string;
  liceId: string;
  tournamentId: string;
  scoringConfig: TournamentScoringConfig | null;
  weapon: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const bracket = useLazyFetch<TournamentBracketPayload | null>(
    `${apiUrl}/api/v1/staff/lices/${liceId}/tournaments/${tournamentId}/bracket`,
    open,
  );
  const slots = (bracket.data?.slots ?? []) as BracketSlotData[];
  const focus = buildLiceBracketFocus(slots, liceId);
  useScrollToBracketSlot(scrollerRef, focus.scrollTargetSlotId, open, slots.length > 0);

  return (
    <CollapsibleSection
      open={open}
      onToggle={() => setOpen((v) => !v)}
      headerClassName="min-h-[44px] w-full rounded-xl border border-border bg-surface px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted hover:border-muted"
      bodyClassName="mt-2"
      header={t('scoring.lice.bracketSection')}
    >
      <ContextStatus
        loading={bracket.loading}
        error={bracket.error}
        empty={slots.length === 0}
        emptyLabel={t('scoring.lice.bracketEmpty')}
        onRetry={bracket.reload}
      />
      {slots.length > 0 && bracket.data && (
        <BracketTree
          bracket={bracket.data}
          slots={slots}
          liceId={liceId}
          scoringConfig={scoringConfig}
          weapon={weapon}
          scrollerRef={scrollerRef}
          t={t}
        />
      )}
    </CollapsibleSection>
  );
}
