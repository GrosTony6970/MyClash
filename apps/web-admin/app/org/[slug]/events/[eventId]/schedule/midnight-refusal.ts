import { failureCode, type ApiFailure } from '@myclash/api-client';

type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * Why the schedule refused a shift past midnight, in the reader's language.
 *
 * Dragging a bar, or pushing the day back ("running late"), is refused whole
 * when it would carry a bar or a fight past midnight. The API words that in
 * English (its problem `detail`) and sends the facts beside it under the code
 * `schedule_past_midnight` — the coded-refusal exception of `failure-message.ts`,
 * chosen by the operator on 2026-11-21. Null for any other failure, and for a
 * body whose facts do not read, so the caller falls back to the API's own words.
 *
 * Literal keys, never composed: the i18n reverse sweep resolves a dotted string
 * literal only.
 */
export function midnightRefusal(failure: ApiFailure, t: Translate): string | null {
  if (failureCode(failure) !== 'schedule_past_midnight' || failure.kind !== 'http') return null;
  const facts = failure.details ?? {};
  const action = facts['action'] as { kind?: unknown; bar?: unknown } | undefined;
  const crossing = facts['crossing'] as { kind?: unknown; name?: unknown } | undefined;
  const { deltaMin, from, to } = facts;
  if (typeof deltaMin !== 'number' || typeof from !== 'string' || typeof to !== 'string') {
    return null;
  }

  let what: string;
  if (crossing?.kind === 'bar' && typeof crossing.name === 'string') {
    what = t('organizer.schedulePage.grid.pastMidnightBar', { name: crossing.name });
  } else if (crossing?.kind === 'fight') {
    what =
      typeof crossing.name === 'string' && crossing.name
        ? t('organizer.schedulePage.grid.pastMidnightFight', { name: crossing.name })
        : t('organizer.schedulePage.grid.pastMidnightAFight');
  } else {
    return null;
  }

  const delta = deltaMin > 0 ? `+${deltaMin}` : String(deltaMin);
  if (action?.kind === 'move' && typeof action.bar === 'string') {
    return t('organizer.schedulePage.grid.pastMidnightMove', {
      bar: action.bar,
      delta,
      what,
      from,
      to,
    });
  }
  if (action?.kind === 'delay') {
    return t('organizer.schedulePage.grid.pastMidnightDelay', { delta, what, from, to });
  }
  return null;
}
