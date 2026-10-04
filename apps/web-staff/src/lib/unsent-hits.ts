/**
 * What the sign-in screen says about hits this tablet still holds (ruling 241).
 *
 * A tablet whose session has ended lands on the sign-in screen, which shows no
 * sync bar: the hits waited there unseen. They are not sent from that screen
 * (nobody is signed in), so it only says they exist and what to do.
 */

type Translate = (key: string, values?: Record<string, string | number>) => string;

// Literal keys, never composed: the i18n reverse sweep resolves a dotted string
// literal only. `t()` has no plural engine, so one hit has its own key.
const UNSENT_ONE = 'scoring.login.unsentOne';
const UNSENT_MANY = 'scoring.login.unsentMany';

export function unsentHitsMessage(count: number, t: Translate): string | null {
  if (count <= 0) return null;
  return count === 1 ? t(UNSENT_ONE) : t(UNSENT_MANY, { count });
}
