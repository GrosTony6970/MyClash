import { Logger, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectsFor } from '../../common/testing/supabase-chain';
import {
  ANON,
  ANON_REQ,
  EVENT,
  LICE,
  RUNNING_ON_LICE,
  build,
  liceRow,
  type LiceCurrent,
} from './staff.service.public-lice.fixtures';

/**
 * The public piste display — the endpoint a venue TV points at.
 *
 * No session, no organiser, no staff cookie: it takes an event slug and a piste
 * NAME off the URL and answers with whatever is on that piste. Piste names are
 * unique per event, not globally, so `Piste 1` exists at every event in the
 * database. The event scope in front of the name match is the only thing
 * keeping one venue's screen off another venue's bout.
 *
 * `lices` is seeded as ROWS here, so both halves of the lookup are OUTCOMES:
 * the event scope is proved by a same-named piste at another event that would
 * otherwise sort first, and the name match by which board comes back. The
 * double models `ilike` as Postgres does — `%` any run, `_` exactly one,
 * anchored at both ends — which is what made the old single-query lookup
 * (`.ilike('name', liceName)`) reproducible as a unit test at all: a `Piste_1`
 * URL answered with `Piste 1`'s scoreboard, and a `%` URL matched every piste
 * and fell out of `maybeSingle` as a raw PostgREST message in a 400.
 *
 * Two pistes of one event may share a name — nothing in the schema stops it
 * (`lices` has no unique index on the pair, and only `lices.service` trims a
 * typed name; the venue catalogue copies its own through untouched). So the
 * name match is a resolution with a deciding order, not a lookup.
 *
 * The controller is driven as well as the service, because the name reaches the
 * lookup through it: Fastify's router has already percent-decoded the segment,
 * so a second decode there is the same defect one layer up.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StaffService.getPublicLiceCurrent', () => {
  it('answers with the board of the piste whose name is in the URL, at that URL event', async () => {
    const { service, supabase } = build(RUNNING_ON_LICE);

    const result = (await service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      'Piste 1',
      ANON,
    )) as LiceCurrent;

    expect(result.liceId).toBe(LICE);
    expect(result.current?.id).toBe('match-here');
    // The name is compared here, not by the database, so the projection has to
    // carry it: with the column dropped the fold reads undefined and the route
    // throws a TypeError — a 500 on a public screen, not a quiet miss.
    expect(selectsFor(supabase.from, 'lices')).toContain('id,name');
  });

  it('does not hand a `Piste_1` URL the board of `Piste 1`', async () => {
    const { service } = build(RUNNING_ON_LICE);

    await expect(
      service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste_1', ANON),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers a `%` URL with our own not-found, not the database’s message', async () => {
    const { service } = build(RUNNING_ON_LICE);

    const error = await service
      .getPublicLiceCurrent(`slug-${EVENT}`, '%', ANON)
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe('Lice not found');
  });

  it('finds the piste when the URL name differs only in case and padding', async () => {
    const { service } = build(RUNNING_ON_LICE);

    const result = (await service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      '  piste 1  ',
      ANON,
    )) as LiceCurrent;

    expect(result.liceId).toBe(LICE);
    expect(result.current?.id).toBe('match-here');
  });

  it('tells `Piste1` from `Piste 1` — the fold trims, it does not strip', async () => {
    const { service } = build(RUNNING_ON_LICE);

    const result = (await service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      'Piste1',
      ANON,
    )) as LiceCurrent;

    expect(result.liceId).toBe('lice-3');
  });

  it('takes the lowest sort_order, then the lowest id, when two pistes share a name', async () => {
    // The two keys disagree and neither agrees with the seed order, so the
    // winner is the one only `sort_order` THEN `id` picks: `lice-a` has the
    // lowest id, `lice-z` comes first as seeded, and both are wrong.
    const { service } = build(
      [],
      [
        liceRow('lice-z', ' Piste 1 ', EVENT, 1),
        liceRow('lice-m', 'Piste 1', EVENT, 1),
        liceRow('lice-a', 'PISTE 1', EVENT, 5),
      ],
    );

    const result = (await service.getPublicLiceCurrent(
      `slug-${EVENT}`,
      'Piste 1',
      ANON,
    )) as LiceCurrent;

    expect(result.liceId).toBe('lice-m');
  });

  it('says so when two pistes answer to one name, because the screen cannot', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = build(
      [],
      [liceRow('lice-m', 'Piste 1', EVENT, 1), liceRow('lice-z', ' PISTE 1', EVENT, 1)],
    );

    await service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', ANON);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 pistes named "piste 1"'));
  });

  it('stays quiet when one piste answers', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = build(RUNNING_ON_LICE);

    await service.getPublicLiceCurrent(`slug-${EVENT}`, 'Piste 1', ANON);

    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses an event slug that does not exist rather than falling back to one', async () => {
    const { service } = build();

    await expect(
      service.getPublicLiceCurrent('slug-nowhere', 'Piste 1', ANON),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Fastify's router percent-decodes a path parameter before the handler sees it,
 * so the controller receives the piste's real name. Decoding again turned a
 * name that merely LOOKS like an escape into a different name.
 */
describe('StaffController.publicLiceCurrent takes the name as the router decoded it', () => {
  it('does not turn a piste named `Piste%201` into `Piste 1`', async () => {
    const { controller } = build(RUNNING_ON_LICE);

    const result = (await controller.publicLiceCurrent(
      `slug-${EVENT}`,
      'Piste%201',
      ANON_REQ,
    )) as LiceCurrent;

    expect(result.liceId).toBe('lice-esc');
  });

  it('answers for a piste whose name holds a bare `%` instead of failing', async () => {
    const { controller } = build(RUNNING_ON_LICE);

    const result = (await controller.publicLiceCurrent(
      `slug-${EVENT}`,
      '100% Cotton',
      ANON_REQ,
    )) as LiceCurrent;

    expect(result.liceId).toBe('lice-pct');
  });

  it('still finds an ordinary name', async () => {
    const { controller } = build(RUNNING_ON_LICE);

    const result = (await controller.publicLiceCurrent(
      `slug-${EVENT}`,
      'Piste 1',
      ANON_REQ,
    )) as LiceCurrent;

    expect(result.liceId).toBe(LICE);
    expect(result.current?.id).toBe('match-here');
  });
});
