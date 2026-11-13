'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { FindCard } from '@myclash/types';
import { Avatar } from '@myclash/ui';
import { AskToSpar } from '@/components/fightbook/AskToSpar';
import { FavouriteHeart } from '@/components/fightbook/FavouriteHeart';

/** A card's text block: name, club, weapons and, in the Event block, the "free now" badge. */
function CardText(props: {
  name: string;
  club: string | null;
  weapons: string[];
  freeNow?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 flex-1 basis-40">
      <p className="truncate text-sm font-semibold text-foreground">{props.name}</p>
      {props.club ? <p className="truncate text-xs text-muted">{props.club}</p> : null}
      {props.weapons.length > 0 ? (
        <p className="text-xs text-muted">
          {t('publicApp.fightBook.card.weapons', { weapons: props.weapons.join(', ') })}
        </p>
      ) : null}
      {props.freeNow ? (
        <span
          data-free-now
          className="mt-1 inline-block rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success"
        >
          {t('publicApp.fightBook.floor.freeBadge')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Find a partner's cards, for the Event block and All of FightBook: the fighter's photo (initials
 * when there is none), name, club and weapons, and "Ask to spar". `eventId` names the Event the
 * ask preselects; a sent ask tells the page (`onSent`).
 */
export function FindCards(props: {
  /** `freeNow` rides only on the Event block's cards (ruling 708); the others have none. */
  cards: Array<FindCard & { freeNow?: boolean }>;
  eventId?: string;
  apiUrl: string;
  onSent: () => void;
  /** A heart on a card was set or removed (the Favourites tab drops a removed card). */
  onHearted?: (globalPersonId: string, favourite: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-3">
      {props.cards.map(({ fighter, weapons, favourite, freeNow }) => {
        const name = fighter.name || t('publicApp.fightBook.unknownFighter');
        return (
          <li
            key={fighter.globalPersonId}
            data-find-card
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <Avatar name={name} src={fighter.photoUrl ?? undefined} size="md" />
            <CardText name={name} club={fighter.club} weapons={weapons} freeNow={freeNow} />
            <AskToSpar
              receiverGlobalPersonId={fighter.globalPersonId}
              name={name}
              eventId={props.eventId}
              apiUrl={props.apiUrl}
              onSent={props.onSent}
            />
            <FavouriteHeart
              apiUrl={props.apiUrl}
              globalPersonId={fighter.globalPersonId}
              name={name}
              favourite={favourite}
              onChanged={(next) => props.onHearted?.(fighter.globalPersonId, next)}
            />
          </li>
        );
      })}
    </ul>
  );
}
