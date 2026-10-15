import type { ClaimStatus, ClockStatus, MatchStatus } from '@myclash/types';
import type { Translator } from '../types/translator';
import type { TournamentStatus } from './status-pill';

/** `events.status`: the five values of `events_status_check` (pinned by the test). */
export type EventStatus = 'draft' | 'published' | 'running' | 'completed' | 'archived';

/** `registrations.status`: the five values of `registration_status_check` (pinned by the test). */
export type RegistrationStatus =
  'registered' | 'checked_in' | 'withdrawn' | 'disqualified' | 'waitlist';

/**
 * The one word for each state of each domain, in every app (quick win X1, operator ruling
 * 2026-10-14). A screen asks for the KEY and words it with its own `t`: packages/ui never
 * translates by itself, and must not import a message tree.
 *
 * Each map is a `Record` over the domain's union, so a state added to the union does not compile
 * until it has a word; and every key is written whole, so the i18n sweep checks each word both
 * ways (a key with no word, a word nobody asks for).
 */
const MATCH: Record<MatchStatus, string> = {
  scheduled: 'common.status.match.scheduled',
  running: 'common.status.match.running',
  paused: 'common.status.match.paused',
  completed: 'common.status.match.completed',
  voided: 'common.status.match.voided',
};

const CLOCK: Record<ClockStatus, string> = {
  idle: 'common.status.clock.idle',
  running: 'common.status.clock.running',
  halted: 'common.status.clock.halted',
  ended: 'common.status.clock.ended',
};

const EVENT: Record<EventStatus, string> = {
  draft: 'common.status.event.draft',
  published: 'common.status.event.published',
  running: 'common.status.event.running',
  completed: 'common.status.event.completed',
  archived: 'common.status.event.archived',
};

const TOURNAMENT: Record<TournamentStatus, string> = {
  draft: 'common.status.tournament.draft',
  published: 'common.status.tournament.published',
  running: 'common.status.tournament.running',
  completed: 'common.status.tournament.completed',
  archived: 'common.status.tournament.archived',
};

const REGISTRATION: Record<RegistrationStatus, string> = {
  registered: 'common.status.registration.registered',
  checked_in: 'common.status.registration.checked_in',
  withdrawn: 'common.status.registration.withdrawn',
  disqualified: 'common.status.registration.disqualified',
  waitlist: 'common.status.registration.waitlist',
};

const CLAIM: Record<ClaimStatus, string> = {
  unclaimed: 'common.status.claim.unclaimed',
  guest_active: 'common.status.claim.guest_active',
  claimed: 'common.status.claim.claimed',
};

const STATUS_LABEL_KEYS = {
  match: MATCH,
  clock: CLOCK,
  event: EVENT,
  tournament: TOURNAMENT,
  registration: REGISTRATION,
  claim: CLAIM,
} as const;

export type StatusLabelDomain = keyof typeof STATUS_LABEL_KEYS;
export type StatusOf<Domain extends StatusLabelDomain> = keyof (typeof STATUS_LABEL_KEYS)[Domain];

/** The i18n key of one state's word. */
export function statusLabelKey<Domain extends StatusLabelDomain>(
  domain: Domain,
  status: StatusOf<Domain>,
): string {
  return (STATUS_LABEL_KEYS[domain] as Record<PropertyKey, string>)[status]!;
}

/** True when the domain has a word for this value, read as a plain string. */
export function isKnownStatus<Domain extends StatusLabelDomain>(
  domain: Domain,
  status: string,
): status is StatusOf<Domain> & string {
  return Object.hasOwn(STATUS_LABEL_KEYS[domain], status);
}

/**
 * The word of a state read as a plain string (an API row). A value the domain does not know (a
 * state the database gained after this build) is shown as it is: the maps are pinned to the
 * column's CHECK list by their tests, so only a new state can reach this branch.
 */
export function statusLabel(domain: StatusLabelDomain, status: string, t: Translator): string {
  return isKnownStatus(domain, status) ? t(statusLabelKey(domain, status)) : status;
}
