/**
 * Which events get badged, and how — one owner for two surfaces.
 *
 * The login picker warns a volunteer that they are about to sign into a test or
 * a club event; the banner keeps warning them for the rest of the day. Both
 * must draw the same conclusion from the same value, so the rule lives here
 * rather than in each of them.
 *
 * `standard` gets nothing on purpose. It is the unremarkable case, and a badge
 * on every event would train volunteers to read past the one that matters.
 */

export type EventKindTone = 'danger' | 'warning' | 'muted';

export interface EventKindBadge {
  tone: EventKindTone;
  /**
   * A literal key, never a template. A computed t() key is invisible to
   * t-key-references.test.ts, so its French string would ship missing and no
   * gate would notice.
   */
  labelKey: string;
}

export function eventKindTone(kind: string | null | undefined): EventKindBadge | null {
  if (kind === 'test') return { tone: 'danger', labelKey: 'scoring.login.picker.badgeTest' };
  if (kind === 'club') return { tone: 'muted', labelKey: 'scoring.login.picker.badgeClub' };
  return null;
}
