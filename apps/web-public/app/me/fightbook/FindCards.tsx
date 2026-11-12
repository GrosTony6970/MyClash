'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { FindCard } from '@myclash/types';
import { Avatar } from '@myclash/ui';
import { AskToSpar } from '@/components/fightbook/AskToSpar';

/**
 * Find a partner's cards, for the Event block and All of FightBook: the fighter's photo (initials
 * when there is none), name, club and weapons, and "Ask to spar". `eventId` names the Event the
 * ask preselects; a sent ask tells the page (`onSent`).
 */
export function FindCards(props: {
  cards: FindCard[];
  eventId?: string;
  apiUrl: string;
  onSent: () => void;
}) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-3">
      {props.cards.map(({ fighter, weapons }) => {
        const name = fighter.name || t('publicApp.fightBook.unknownFighter');
        return (
          <li
            key={fighter.globalPersonId}
            data-find-card
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
          >
            <Avatar name={name} src={fighter.photoUrl ?? undefined} size="md" />
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
              {fighter.club ? <p className="truncate text-xs text-muted">{fighter.club}</p> : null}
              {weapons.length > 0 ? (
                <p className="text-xs text-muted">
                  {t('publicApp.fightBook.card.weapons', { weapons: weapons.join(', ') })}
                </p>
              ) : null}
            </div>
            <AskToSpar
              receiverGlobalPersonId={fighter.globalPersonId}
              name={name}
              eventId={props.eventId}
              apiUrl={props.apiUrl}
              onSent={props.onSent}
            />
          </li>
        );
      })}
    </ul>
  );
}
