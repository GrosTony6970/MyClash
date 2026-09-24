/**
 * Who may search fighters, `GET /fighters` (operator ruling 99): any signed-in
 * personal account. A signed-out caller gets a 401; an Event staff login or a
 * guest token gets a 403, because neither is a person's own account. Every
 * account sees the same rows: the reachable filter and the privacy map already
 * apply in the service.
 *
 * The weapon catalogue, `GET /weapons`, is public: web-public's Event list and
 * fighter directory call it with no login.
 *
 * Until 2026-09-24 both routes had no `@Public()` and no check: anyone could
 * search every global person, because the AuthGuard runs in shadow mode.
 */
import 'reflect-metadata';
import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import { mockSupabase, type TableSeed } from '../../common/testing/supabase-chain';
import { FightersController, WeaponsController } from './fighters.controller';
import { FightersService } from './fighters.service';

const USER = '11111111-1111-4111-8111-111111111111';
const QUERY = { q: 'Anna', limit: 10 };

const claimed = { identity: { kind: 'claimed', userId: USER, email: null } };
const STAFF = { identity: { kind: 'staff', staffId: 's-1', eventId: 'e-1' } };
const GUEST = {
  identity: { kind: 'guest', guestSessionId: 'g-1', personId: 'p-1', eventId: 'e-1' },
};

function realService(tables: Record<string, TableSeed>, rpc = vi.fn()) {
  const db = mockSupabase(tables);
  return new FightersService({ service: { from: db.from, rpc } } as never, {} as never);
}

describe('GET /fighters (ruling 99)', () => {
  let list: ReturnType<typeof vi.fn>;
  let controller: FightersController;

  beforeEach(() => {
    list = vi.fn().mockResolvedValue([]);
    controller = new FightersController({ list } as never, {} as never, {} as never);
  });

  const search = (req: unknown) => controller.list(QUERY as never, req as never);

  it('lets a signed-in account search, with the same query and no club needed', async () => {
    await search(claimed);
    expect(list).toHaveBeenCalledWith(QUERY);
  });

  it.each([
    ['a signed-out caller', { identity: { kind: 'anonymous' } }],
    ['a request carrying no identity at all', {}],
  ])('refuses %s with a 401, before any read', async (_label, req) => {
    await expect(search(req)).rejects.toThrow(UnauthorizedException);
    expect(list).not.toHaveBeenCalled();
  });

  it.each([
    ['an Event staff login', STAFF],
    ['a guest token', GUEST],
  ])('refuses %s with a 403, before any read', async (_label, req) => {
    await expect(search(req)).rejects.toThrow(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
  });

  it('fails a failed search read loudly (5xx), never as a 400 carrying the database text', async () => {
    const service = realService({ global_persons: { data: null, error: { message: 'boom' } } });
    const call = service.list({} as never);
    await expect(call).rejects.toThrow('fighter search read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });

  it('fails a failed read of the fuzzy matches loudly, never as "nobody matched"', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'gp-1' }], error: null });
    const service = realService(
      { global_persons: { data: null, error: { message: 'boom' } } },
      rpc,
    );
    const call = service.list({ q: 'Anna' } as never);
    await expect(call).rejects.toThrow('fighter search read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});

describe('GET /weapons (ruling 99)', () => {
  const CATALOG: Record<string, TableSeed> = {
    weapon_catalog: {
      rows: [
        { name: 'Sabre', active: false },
        { name: 'Longsword', active: true },
      ],
    },
  };

  it('is public, and answers the active catalogue a picker asks for', async () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, WeaponsController.prototype.list)).toBe(true);
    const rows = (await new WeaponsController(realService(CATALOG)).list('true')) as {
      name: string;
    }[];
    expect(rows.map((row) => row.name)).toEqual(['Longsword']);
  });

  it('fails a failed catalogue read loudly (5xx), never as a 400 carrying the database text', async () => {
    const service = realService({ weapon_catalog: { data: null, error: { message: 'boom' } } });
    const call = new WeaponsController(service).list();
    await expect(call).rejects.toThrow('weapon catalogue read failed: boom');
    await expect(call).rejects.not.toBeInstanceOf(HttpException);
  });
});
