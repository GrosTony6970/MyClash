import type { PhotoTag } from './send-photo';

/**
 * `t:<id>` or `w:<id>`, the value of a Tournament / Workshop picker, as the tag the API takes. The
 * send page's picker and the photos page's filter both use it.
 */
export function tagOf(value: string): PhotoTag | null {
  const id = value.slice(2);
  if (value.startsWith('t:') && id) return { kind: 'tournament', id };
  if (value.startsWith('w:') && id) return { kind: 'workshop', id };
  return null;
}
