import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

/**
 * listPublic — the anonymous organiser directory behind /organisers.
 *
 * Its own file rather than another describe in organizations.service.test.ts:
 * that file is already near the 400-line budget, and these tests need a
 * different mock shape (awaitable chains with .range/.ilike, dispatched by
 * table name) from the .maybeSingle()-terminated chains the rest of it uses.
 */

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

/**
 * Awaitable chain with the methods listPublic actually calls. Dispatched by
 * TABLE NAME rather than call order: listPublic issues its two count queries
 * via Promise.all, so their order is not guaranteed and an order-based mock
 * would be flaky by construction.
 */
function makeQuery(result: unknown) {
  const promise = Promise.resolve(result);
  const methods = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    ilike: vi.fn(),
  };
  const chain = Object.assign(promise, methods);
  for (const method of Object.values(methods)) method.mockReturnValue(chain);
  return chain;
}

const rows = [
  { id: 'org-1', name: 'Amiens AMHE', slug: 'amiens', logo_url: null, brand_color: null },
  {
    id: 'org-2',
    name: 'Lyon AMHE',
    slug: 'lyon',
    logo_url: 'https://cdn/l.png',
    brand_color: '#b91c1c',
  },
];

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}

function mockTables(
  overrides: { orgs?: QueryResult; follows?: QueryResult; events?: QueryResult } = {},
) {
  const chains = {
    organizations: makeQuery(overrides.orgs ?? { data: rows, error: null, count: rows.length }),
    organization_follows: makeQuery(
      overrides.follows ?? { data: [{ followed_organization_id: 'org-2' }], error: null },
    ),
    events: makeQuery(
      overrides.events ?? {
        data: [{ organization_id: 'org-2' }, { organization_id: 'org-2' }],
        error: null,
      },
    ),
  };
  fromMock.mockImplementation((table: keyof typeof chains) => chains[table]);
  return chains;
}

describe('OrganizationsService.listPublic', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrganizationsService(mockSupabase as never);
  });

  it('projects camelCase rows with the tallied counts', async () => {
    mockTables();
    const result = await service.listPublic({});
    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      {
        id: 'org-1',
        name: 'Amiens AMHE',
        slug: 'amiens',
        logoUrl: null,
        brandColor: null,
        followerCount: 0,
        upcomingEventCount: 0,
      },
      {
        id: 'org-2',
        name: 'Lyon AMHE',
        slug: 'lyon',
        logoUrl: 'https://cdn/l.png',
        brandColor: '#b91c1c',
        followerCount: 1,
        upcomingEventCount: 2,
      },
    ]);
  });

  it('lists active organisations only, ordered by name', async () => {
    const chains = mockTables();
    await service.listPublic({});
    expect(chains.organizations.eq).toHaveBeenCalledWith('status', 'active');
    expect(chains.organizations.order).toHaveBeenCalledWith('name', { ascending: true });
  });

  it('counts upcoming events, excluding test events but INCLUDING club events', async () => {
    const chains = mockTables();
    await service.listPublic({});
    expect(chains.events.in).toHaveBeenCalledWith('status', ['published', 'running']);
    expect(chains.events.neq).toHaveBeenCalledWith('event_kind', 'test');
    // Club events are public and real — a directory card that hid them would
    // disagree with the /o/[slug] page, which lists them.
    expect(chains.events.neq).not.toHaveBeenCalledWith('event_kind', 'club');
    expect(chains.events.eq).not.toHaveBeenCalledWith('event_kind', 'standard');
  });

  it('applies the name filter, with PostgREST meta-characters stripped', async () => {
    const chains = mockTables();
    await service.listPublic({ q: 'ly(on),' });
    expect(chains.organizations.ilike).toHaveBeenCalledWith('name', '%lyon%');
  });

  it('does not filter on a query that sanitises to nothing', async () => {
    const chains = mockTables();
    await service.listPublic({ q: '(),' });
    expect(chains.organizations.ilike).not.toHaveBeenCalled();
  });

  it('pages with the default size, and caps an oversized limit', async () => {
    const chains = mockTables();
    await service.listPublic({});
    expect(chains.organizations.range).toHaveBeenCalledWith(0, 23);

    vi.clearAllMocks();
    const capped = mockTables();
    await service.listPublic({ limit: 500, offset: 50 });
    expect(capped.organizations.range).toHaveBeenCalledWith(50, 99);
  });

  it('skips both count queries when the page is empty', async () => {
    mockTables({ orgs: { data: [], error: null, count: 0 } });
    const result = await service.listPublic({ q: 'nothing matches' });
    expect(result).toEqual({ items: [], total: 0 });
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('organizations');
  });

  it('surfaces a query error as a 400', async () => {
    mockTables({ orgs: { data: null, error: { message: 'boom' }, count: null } });
    await expect(service.listPublic({})).rejects.toThrow(BadRequestException);
  });
});
