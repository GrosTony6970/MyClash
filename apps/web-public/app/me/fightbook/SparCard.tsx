'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { SparFighter, SparKind } from '@myclash/types';
import { Avatar } from '@myclash/ui';
import { useDayLabel } from '@/components/fightbook/day-label';

/** When and where a spar is: what every FightBook card says. Day and time are wall clock. */
export interface SparWhenView {
  kind: SparKind;
  eventName: string | null;
  day: string;
  time: string | null;
  place: string | null;
  weapons: string[];
}

/** One FightBook card: the other fighter, when and where, the weapons, the message; then its actions. */
export function SparCard({
  fighter,
  when,
  message,
  note,
  heart,
  children,
}: {
  fighter: SparFighter;
  when: SparWhenView;
  message: string | null;
  note?: ReactNode;
  /** The partner's heart, beside the name; none where the page may not offer one. */
  heart?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const dayLabel = useDayLabel();
  const name = fighter.name || t('publicApp.fightBook.unknownFighter');
  const where =
    when.kind === 'free'
      ? t('publicApp.fightBook.card.place', { place: when.place ?? '' })
      : when.eventName
        ? t('publicApp.fightBook.card.at', { event: when.eventName })
        : t('publicApp.fightBook.card.eventGone');
  const time = when.time ? ` ${t('publicApp.fightBook.card.time', { time: when.time })}` : '';
  return (
    <li data-spar-card className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <Avatar name={name} src={fighter.photoUrl ?? undefined} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          {fighter.club ? <p className="truncate text-xs text-muted">{fighter.club}</p> : null}
          <p className="text-xs text-muted">{`${dayLabel(when.day)}${time} · ${where}`}</p>
        </div>
        {heart}
      </div>
      <p className="mt-2 text-sm text-foreground">
        {t('publicApp.fightBook.card.weapons', { weapons: when.weapons.join(', ') })}
      </p>
      {message ? <p className="mt-1 text-sm italic text-muted">{message}</p> : null}
      {note ? <div className="mt-2 text-sm">{note}</div> : null}
      {children ? <div className="mt-3 flex flex-wrap gap-2">{children}</div> : null}
    </li>
  );
}
