import type { ApiFailure, ApiResult } from '@myclash/api-client';
import type { CatalogueVenue, WizardState } from './wizard-state';

/**
 * The new-Event wizard's writes, one after the other (O13, operator 2026-10-14).
 *
 * A try can stop half-way: the Event made, the venue refused. The next try used to send the
 * Event again and read "slug already taken", with a half-built Event nobody knew about. Now each
 * try remembers what the server took, and the next one sends only what is missing: it keeps the
 * Event (and changes its basics if the organiser edited them), keeps the venue it made unless one
 * of its four fields changed, and sends only the pistes and areas not taken yet. Each write's
 * answer is read; the first refusal stops the try and names itself.
 */

export interface CreateProgress {
  eventId: string | null;
  /** The basics the Event holds, as last sent. */
  sentBasics: string | null;
  /** A venue this wizard made, with what it was made from. */
  madeVenue: { id: string; sent: string } | null;
  /** `venue:index:name` of each piste the Event holds. */
  pistesSent: string[];
  /** `venue:index:name` of each area a venue holds. */
  areasSent: string[];
}

export const NO_PROGRESS: CreateProgress = {
  eventId: null,
  sentBasics: null,
  madeVenue: null,
  pistesSent: [],
  areasSent: [],
};

export type Send = <T>(
  path: string,
  init: { method: 'POST' | 'PATCH'; body: unknown },
) => Promise<ApiResult<T>>;

/** A write the server refused, and the wizard's own words for it when the server gives none. */
export interface CreateRefusal {
  failure: ApiFailure;
  fallbackKey: string;
}

export interface CreateOutcome {
  progress: CreateProgress;
  refusal: CreateRefusal | null;
}

const done = (progress: CreateProgress): CreateOutcome => ({ progress, refusal: null });
const refused = (progress: CreateProgress, failure: ApiFailure, key: string): CreateOutcome => ({
  progress,
  refusal: { failure, fallbackKey: `organizer.newEvent.validation.${key}` },
});

export async function createEventSteps(
  state: WizardState,
  orgId: string,
  catalogue: CatalogueVenue[],
  start: CreateProgress,
  send: Send,
): Promise<CreateOutcome> {
  let outcome = await ensureEvent(state, orgId, start, send);
  if (outcome.refusal) return outcome;
  outcome = await ensureVenue(state, orgId, outcome.progress, send);
  if (outcome.refusal) return outcome;

  const venue = venueOf(state, catalogue, outcome.progress);
  if (venue.hostsTournament) {
    const pistes = pisteItems(state, venue, outcome.progress.eventId!);
    outcome = await sendMissing(outcome.progress, 'pistesSent', pistes, 'liceCreateFailed', send);
    if (outcome.refusal) return outcome;
  }
  // Areas only for a workshop venue, and only when the organiser named some.
  if (venue.hostsWorkshop && venue.id) {
    const areas = areaItems(state, venue.id);
    outcome = await sendMissing(outcome.progress, 'areasSent', areas, 'areaCreateFailed', send);
  }
  return outcome;
}

type Venue = ReturnType<typeof venueOf>;

function pisteItems(state: WizardState, venue: Venue, eventId: string) {
  return state.liceNames.map((raw, index) => {
    const name = raw.trim();
    const body = { name, sortOrder: index, venueId: venue.id ?? undefined };
    // Keyed by venue too: a venue changed between tries takes every piste, not only the
    // ones the first try had not sent.
    const key = `${venue.id ?? ''}:${index}:${name}`;
    return { key, path: `/api/v1/events/${eventId}/lices`, body };
  });
}

function areaItems(state: WizardState, venueId: string) {
  return state.areaNames.map((raw, index) => {
    const name = raw.trim();
    const path = `/api/v1/venues/${venueId}/areas`;
    return { key: `${venueId}:${index}:${name}`, path, body: { name, sortOrder: index } };
  });
}

export type UnsavedPart = 'details' | 'venue' | 'pistes' | 'areas';

/**
 * What the next Create would still send, once the Event is made: the organiser leaving now
 * keeps the Event, a draft, and loses these (ruled 2026-10-15). Nothing before the Event is
 * made: then the whole form is the loss, and the plain question says so.
 */
export function unsavedParts(
  state: WizardState,
  catalogue: CatalogueVenue[],
  progress: CreateProgress,
): UnsavedPart[] {
  if (!progress.eventId) return [];
  const parts: UnsavedPart[] = [];
  if (progress.sentBasics !== JSON.stringify(basicsOf(state))) parts.push('details');
  const newVenue = state.venueMode === 'new' ? newVenueOf(state) : null;
  if (newVenue && progress.madeVenue?.sent !== JSON.stringify(newVenue)) {
    // The venue is not made as it stands: nothing that hangs on it is either.
    parts.push('venue');
    if (newVenue.hostsTournament) parts.push('pistes');
    if (newVenue.hostsWorkshop && state.areaNames.length > 0) parts.push('areas');
    return parts;
  }
  const venue = venueOf(state, catalogue, progress);
  const taken = (list: string[], items: Array<{ key: string }>) =>
    items.every((item) => list.includes(item.key));
  if (venue.hostsTournament && !taken(progress.pistesSent, pisteItems(state, venue, ''))) {
    parts.push('pistes');
  }
  if (venue.hostsWorkshop && venue.id && !taken(progress.areasSent, areaItems(state, venue.id))) {
    parts.push('areas');
  }
  return parts;
}

function basicsOf(state: WizardState) {
  return {
    name: state.name.trim(),
    startDate: state.startDate,
    endDate: state.endDate,
    city: state.city.trim() || null,
    country: state.country || null,
    eventKind: state.eventKind,
  };
}

async function ensureEvent(
  state: WizardState,
  orgId: string,
  progress: CreateProgress,
  send: Send,
): Promise<CreateOutcome> {
  const basics = basicsOf(state);
  const sentBasics = JSON.stringify(basics);
  if (!progress.eventId) {
    const made = await send<{ id: string }>(`/api/v1/organizations/${orgId}/events`, {
      method: 'POST',
      body: { slug: state.slug, ...basics },
    });
    // A slug already taken, a date range the org refuses: the API names which.
    if (!made.ok) return refused(progress, made, 'createFailed');
    return done({ ...progress, eventId: made.data.id, sentBasics });
  }
  if (progress.sentBasics === sentBasics) return done(progress);
  // The slug is locked once the Event exists: only the basics can have changed.
  const edited = await send(`/api/v1/events/${progress.eventId}`, {
    method: 'PATCH',
    body: basics,
  });
  if (!edited.ok) return refused(progress, edited, 'updateFailed');
  return done({ ...progress, sentBasics });
}

function newVenueOf(state: WizardState) {
  return {
    name: state.newVenueName.trim(),
    address: state.newVenueAddress.trim() || undefined,
    hostsTournament: state.newVenueHostsTournament,
    hostsWorkshop: state.newVenueHostsWorkshop,
  };
}

/** Makes the new venue, unless this wizard already made it from the same four fields. */
async function ensureVenue(
  state: WizardState,
  orgId: string,
  progress: CreateProgress,
  send: Send,
): Promise<CreateOutcome> {
  if (state.venueMode !== 'new') return done(progress);
  const venue = newVenueOf(state);
  const sent = JSON.stringify(venue);
  if (progress.madeVenue?.sent === sent) return done(progress);
  const made = await send<{ id: string }>(`/api/v1/organizations/${orgId}/venues`, {
    method: 'POST',
    body: venue,
  });
  if (!made.ok) return refused(progress, made, 'venueCreateFailed');
  return done({ ...progress, madeVenue: { id: made.data.id, sent } });
}

function venueOf(state: WizardState, catalogue: CatalogueVenue[], progress: CreateProgress) {
  if (state.venueMode === 'new' && progress.madeVenue) {
    const venue = newVenueOf(state);
    return { id: progress.madeVenue.id, ...venue };
  }
  const picked =
    state.venueMode === 'existing'
      ? catalogue.find((v) => v.id === state.selectedVenueId)
      : undefined;
  return {
    id: picked?.id ?? null,
    hostsTournament: picked?.hosts_tournament ?? false,
    hostsWorkshop: picked?.hosts_workshop ?? false,
  };
}

/** Sends each item the server does not hold yet, one by one; stops at the first refusal. */
async function sendMissing(
  start: CreateProgress,
  list: 'pistesSent' | 'areasSent',
  items: Array<{ key: string; path: string; body: unknown }>,
  refusedKey: string,
  send: Send,
): Promise<CreateOutcome> {
  let progress = start;
  for (const item of items) {
    if (progress[list].includes(item.key)) continue;
    const made = await send(item.path, { method: 'POST', body: item.body });
    if (!made.ok) return refused(progress, made, refusedKey);
    progress = { ...progress, [list]: [...progress[list], item.key] };
  }
  return done(progress);
}
