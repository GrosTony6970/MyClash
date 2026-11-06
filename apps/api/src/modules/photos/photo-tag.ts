import type { ModerationPhoto } from '@myclash/types';

/** A photo row's tag embeds, as `tournament:tournaments(name), workshop:workshops(title)` read them. */
export interface PhotoTagEmbeds {
  tournament: { name: string } | null;
  workshop: { title: string } | null;
}

/**
 * The tag a moderator and its sender see: the Tournament or the Workshop, or none. The public
 * list has its own (`photo-public.service.ts` `tagOf`): it drops a tag the visitor may not read.
 */
export function photoTag(row: PhotoTagEmbeds): ModerationPhoto['tag'] {
  if (row.tournament) return { kind: 'tournament', name: row.tournament.name };
  if (row.workshop) return { kind: 'workshop', name: row.workshop.title };
  return null;
}
