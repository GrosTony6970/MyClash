import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@myclash/api-client';
import { createEventSteps, NO_PROGRESS, type CreateProgress, type Send } from './create-event';
import { INITIAL, type CatalogueVenue, type WizardState } from './wizard-state';

/**
 * O13 (ruled 2026-10-14): a retry after a partial failure keeps the Event made, and sends only
 * what is missing.
 */

const FORM: WizardState = {
  ...INITIAL,
  step: 4,
  name: 'Open 2027',
  slug: 'open-2027',
  startDate: '2027-05-01',
  endDate: '2027-05-02',
  city: 'Lyon',
  newVenueName: 'Gymnase',
  liceNames: ['Lice 1', 'Lice 2', 'Lice 3'],
};

const REFUSED = {
  ok: false as const,
  kind: 'http' as const,
  status: 400,
  detail: 'refused',
  validationErrors: null,
  code: null,
  details: null,
};

/** The server: every write is taken but the ones `refuse` names, as `METHOD path body-name`. */
function server(refuse: string[] = []) {
  const calls: Array<{ call: string; body: Record<string, unknown> }> = [];
  let id = 0;
  const send: Send = async <T>(path: string, init: { method: string; body: unknown }) => {
    const body = init.body as Record<string, unknown>;
    const call = `${init.method} ${path}`;
    calls.push({ call, body });
    const named = `${call} ${String(body['name'] ?? '')}`.trim();
    if (refuse.includes(call) || refuse.includes(named)) return REFUSED as ApiResult<T>;
    id += 1;
    return { ok: true, data: { id: `id-${id}` } as T };
  };
  return { send, calls, said: () => calls.map((c) => c.call) };
}

const run = (
  state: WizardState,
  progress: CreateProgress,
  send: Send,
  venues: CatalogueVenue[] = [],
) => createEventSteps(state, 'org-1', venues, progress, send);

describe('createEventSteps', () => {
  it('makes the Event, the venue and each piste, in order, on a first try', async () => {
    const api = server();
    const outcome = await run(FORM, NO_PROGRESS, api.send);
    expect(outcome.refusal).toBeNull();
    expect(api.said()).toEqual([
      'POST /api/v1/organizations/org-1/events',
      'POST /api/v1/organizations/org-1/venues',
      'POST /api/v1/events/id-1/lices',
      'POST /api/v1/events/id-1/lices',
      'POST /api/v1/events/id-1/lices',
    ]);
    expect(api.calls[0]!.body).toMatchObject({ slug: 'open-2027', name: 'Open 2027' });
    expect(api.calls[2]!.body).toEqual({ name: 'Lice 1', sortOrder: 0, venueId: 'id-2' });
  });

  it('keeps the Event made when the venue is refused, and the retry sends it no more', async () => {
    const first = await run(
      FORM,
      NO_PROGRESS,
      server(['POST /api/v1/organizations/org-1/venues']).send,
    );
    expect(first.refusal?.fallbackKey).toBe('organizer.newEvent.validation.venueCreateFailed');
    expect(first.progress.eventId).toBe('id-1');

    const api = server();
    const retry = await run(FORM, first.progress, api.send);
    expect(retry.refusal).toBeNull();
    expect(api.said()).not.toContain('POST /api/v1/organizations/org-1/events');
    expect(api.said()[0]).toBe('POST /api/v1/organizations/org-1/venues');
  });

  it('changes the Event once when its name changed between tries, never its address', async () => {
    const first = await run(
      FORM,
      NO_PROGRESS,
      server(['POST /api/v1/organizations/org-1/venues']).send,
    );
    const api = server();
    await run({ ...FORM, name: 'Open 2027 bis' }, first.progress, api.send);
    const edits = api.calls.filter((c) => c.call === 'PATCH /api/v1/events/id-1');
    expect(edits).toHaveLength(1);
    expect(edits[0]!.body).toMatchObject({ name: 'Open 2027 bis' });
    expect(edits[0]!.body).not.toHaveProperty('slug');
  });

  it('names a refused piste, and the retry sends only the pistes not taken, in their place', async () => {
    const refusing = server(['POST /api/v1/events/id-1/lices Lice 2']);
    const first = await run(FORM, NO_PROGRESS, refusing.send);
    expect(first.refusal?.fallbackKey).toBe('organizer.newEvent.validation.liceCreateFailed');
    expect(first.refusal?.failure).toMatchObject({ detail: 'refused' });

    const api = server();
    await run(FORM, first.progress, api.send);
    expect(api.calls.map((c) => c.body)).toEqual([
      { name: 'Lice 2', sortOrder: 1, venueId: 'id-2' },
      { name: 'Lice 3', sortOrder: 2, venueId: 'id-2' },
    ]);
  });

  it('makes the venue again when one of its four fields changed', async () => {
    const first = await run(
      FORM,
      NO_PROGRESS,
      server(['POST /api/v1/events/id-1/lices Lice 1']).send,
    );
    const api = server();
    await run({ ...FORM, newVenueAddress: '1 rue des Arts' }, first.progress, api.send);
    expect(api.said()[0]).toBe('POST /api/v1/organizations/org-1/venues');
  });

  // From the review of push 3: a piste taken, then the venue edited before the retry.
  it('sends every piste to the venue made again, not only the ones not sent yet', async () => {
    const first = await run(
      FORM,
      NO_PROGRESS,
      server(['POST /api/v1/events/id-1/lices Lice 2']).send,
    );
    const api = server();
    await run({ ...FORM, newVenueAddress: '1 rue des Arts' }, first.progress, api.send);
    expect(api.calls.filter((c) => c.call === 'POST /api/v1/events/id-1/lices')).toEqual([
      expect.objectContaining({ body: { name: 'Lice 1', sortOrder: 0, venueId: 'id-1' } }),
      expect.objectContaining({ body: { name: 'Lice 2', sortOrder: 1, venueId: 'id-1' } }),
      expect.objectContaining({ body: { name: 'Lice 3', sortOrder: 2, venueId: 'id-1' } }),
    ]);
  });

  it('sends each area of a workshop venue once', async () => {
    const workshop = { ...FORM, newVenueHostsWorkshop: true, areaNames: ['Salle A', 'Salle B'] };
    const first = await run(
      workshop,
      NO_PROGRESS,
      server(['POST /api/v1/venues/id-2/areas Salle B']).send,
    );
    expect(first.refusal?.fallbackKey).toBe('organizer.newEvent.validation.areaCreateFailed');
    const api = server();
    await run(workshop, first.progress, api.send);
    expect(api.calls).toEqual([
      { call: 'POST /api/v1/venues/id-2/areas', body: { name: 'Salle B', sortOrder: 1 } },
    ]);
  });

  it('uses a venue of the club as it is, and makes none', async () => {
    const hall: CatalogueVenue = {
      id: 'v-9',
      name: 'Hall',
      address: null,
      hosts_tournament: true,
      hosts_workshop: false,
    };
    const api = server();
    await run({ ...FORM, venueMode: 'existing', selectedVenueId: 'v-9' }, NO_PROGRESS, api.send, [
      hall,
    ]);
    expect(api.said()).not.toContain('POST /api/v1/organizations/org-1/venues');
    expect(api.calls[1]!.body).toEqual({ name: 'Lice 1', sortOrder: 0, venueId: 'v-9' });
  });
});
