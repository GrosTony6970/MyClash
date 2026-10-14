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
  /** `index:name` of each piste the Event holds. */
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
  const eventId = outcome.progress.eventId!;
  if (venue.hostsTournament) {
    const pistes = state.liceNames.map((raw, index) => {
      const name = raw.trim();
      const body = { name, sortOrder: index, venueId: venue.id ?? undefined };
      return { key: `${index}:${name}`, path: `/api/v1/events/${eventId}/lices`, body };
    });
    outcome = await sendMissing(outcome.progress, 'pistesSent', pistes, 'liceCreateFailed', send);
    if (outcome.refusal) return outcome;
  }
  // Areas only for a workshop venue, and only when the organiser named some.
  if (venue.hostsWorkshop && venue.id) {
    const areas = state.areaNames.map((raw, index) => {
      const name = raw.trim();
      const path = `/api/v1/venues/${venue.id}/areas`;
      return { key: `${venue.id}:${index}:${name}`, path, body: { name, sortOrder: index } };
    });
    outcome = await sendMissing(outcome.progress, 'areasSent', areas, 'areaCreateFailed', send);
  }
  return outcome;
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
