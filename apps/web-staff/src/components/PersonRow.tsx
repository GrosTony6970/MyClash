'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { RosterEntry } from '../lib/useDesk';

interface Props {
  person: RosterEntry;
  /**
   * Whatever this surface does to a person: one Arrived button at the desk,
   * three result buttons per weapon at gear check.
   *
   * A slot rather than a prop union because the gear screen is deliberately
   * "the desk screen with a different action strip" — building it as a second
   * component would mean maintaining the photo/club/name confirmation logic
   * twice, and that logic is the part that stops a volunteer checking in the
   * wrong Marie.
   */
  actions: ReactNode;
  /**
   * A standing chip beside the name — the gear table's worst-result-wins state.
   *
   * Optional because the desk has none: an arrival is a two-state thing already
   * spelled out in words by the action strip, and a second chip saying the same
   * thing would be noise.
   */
  status?: ReactNode;
  /** Extra detail under the name — gear check hangs its per-weapon rows here. */
  children?: ReactNode;
}

/**
 * One person, as both event-day desks see them.
 *
 * Photo and club are not decoration. The volunteer's job is confirming the
 * human standing in front of them, and two fighters with similar names is the
 * failure this prevents — a name alone does not prevent it.
 */
export function PersonRow({ person, actions, status, children }: Props) {
  const { t } = useI18n();
  const club = person.clubName ?? t('scoring.desk.noClub');

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-3">
        <PersonAvatar person={person} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">
            {person.givenName} {person.familyName}
          </p>
          <p className="truncate text-sm text-muted">{club}</p>
        </div>
        {status && <div className="shrink-0">{status}</div>}
        <div className="shrink-0">{actions}</div>
      </div>
      {children}
    </div>
  );
}

/**
 * The fighter's photo, or their initials.
 *
 * `photo_url` lives on `global_persons`, so a roster entry that was never
 * linked to a global identity has none. Initials rather than a generic
 * silhouette: they still help disambiguate two similar names, which is the
 * whole reason the avatar is here.
 */
function PersonAvatar({ person }: { person: RosterEntry }) {
  const initials = `${person.givenName.charAt(0)}${person.familyName.charAt(0)}`.toUpperCase();

  if (!person.photoUrl) {
    return (
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-foreground/10 text-sm font-bold text-muted">
        {initials}
      </div>
    );
  }

  return (
    // Plain <img>: these are remote roster photos on arbitrary hosts, and
    // next/image would need every one of them in remotePatterns.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={person.photoUrl}
      alt=""
      className="h-12 w-12 shrink-0 rounded-full object-cover"
      loading="lazy"
    />
  );
}
