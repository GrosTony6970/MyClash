import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HemaRatingsService, parseHemaRatingsDetailHtml } from './hema-ratings.service';

function makeLatestSnapshotChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

/**
 * Chain that supports BOTH read (`.select().order().limit().maybeSingle()`)
 * and write (`.update(...).eq(...)`) paths against the same table mock,
 * needed by tests that exercise patchSnapshotEntry via the search /
 * sync surfaces.
 */
function makeReadWriteSnapshotChain(readResult: unknown) {
  const chain = {
    select: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(readResult),
    update: vi.fn(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  // Tests opt into mocking fetch when they exercise the upstream HEMA
  // path. Default to rejecting so an unmocked test doesn't accidentally
  // hit hemaratings.com over the network — slow, flaky, and a violation
  // of unit-test isolation.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch disabled in unit tests')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HemaRatingsService', () => {
  it('parses current HEMA detail table layout with club, nationality, and all weighted ratings', () => {
    const parsed = parseHemaRatingsDetailHtml(
      '6282',
      `
      <h1>Anthony Garnier</h1>
      <article>
        <table>
          <tbody>
            <tr><td><strong>Club</strong></td><td><a href="/clubs/details/1078/">Lyon AMHE</a></td></tr>
            <tr><td><strong>Nationality</strong></td><td>France <i class="flag-icon flag-icon-fr" title="France"></i></td></tr>
          </tbody>
        </table>
      </article>
      <article>
        <h3>Ratings</h3>
        <table class="table table-striped">
          <thead>
            <tr>
              <th>Category</th>
              <th>Last competed</th>
              <th>Rank (current)</th>
              <th>Weighted Rating (current)</th>
              <th>Rank (best)</th>
              <th>Weighted Rating (best)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colspan="6"><strong>Longsword</strong></td></tr>
            <tr>
              <td>- <a href="/periods/details/?ratingsetid=1">Mixed &amp; Men&#39;s Steel Longsword</a></td>
              <td>October 2025</td>
              <td>523 (top 7%)</td>
              <td>1532.6</td>
              <td>456 (February 2022)</td>
              <td>1543.3 (October 2025)</td>
            </tr>
            <tr><td colspan="6"><strong>Sabre</strong></td></tr>
            <tr>
              <td>- <a>Mixed &amp; Men&#39;s Steel Sabre</a></td>
              <td>November 2024</td>
              <td>896 (top 28%)</td>
              <td>1286.9</td>
              <td>193 (March 2022)</td>
              <td>1306.5 (November 2024)</td>
            </tr>
            <tr><td colspan="6"><strong>Rapier and Dagger</strong></td></tr>
            <tr>
              <td>- <a>Mixed &amp; Men&#39;s Steel Rapier and Dagger</a></td>
              <td>October 2025</td>
              <td>192 (top 13%)</td>
              <td>1460.9</td>
              <td>153 (October 2025)</td>
              <td>1465.9 (October 2025)</td>
            </tr>
            <tr><td colspan="6"><strong>Single Rapier</strong></td></tr>
            <tr>
              <td>- <a>Mixed &amp; Men&#39;s Steel Single Rapier</a></td>
              <td>May 2025</td>
              <td>173 (top 8% of island)</td>
              <td>1542.2</td>
              <td>136 (May 2025)</td>
              <td>1553 (May 2025)</td>
            </tr>
            <tr><td colspan="6"><strong>Sword and Buckler</strong></td></tr>
            <tr>
              <td>- <a>Mixed &amp; Men&#39;s Steel Sword and Buckler</a></td>
              <td>November 2019</td>
              <td>Inactive</td>
              <td>1268.3</td>
              <td>72 (September 2018)</td>
              <td>1492.1 (September 2018)</td>
            </tr>
            <tr><td colspan="6"><strong>Sidesword</strong></td></tr>
            <tr>
              <td>- <a>Mixed &amp; Men&#39;s Steel Single Sidesword</a></td>
              <td>May 2025</td>
              <td>100 (top 11%)</td>
              <td>1482.9</td>
              <td>75 (May 2025)</td>
              <td>1495.1 (May 2025)</td>
            </tr>
          </tbody>
        </table>
      </article>
      `,
    );

    expect(parsed.club).toBe('Lyon AMHE');
    expect(parsed.nationality).toBe('France');
    expect(parsed.ratings).toHaveLength(6);
    expect(parsed.ratings[0]).toEqual({
      weapon: 'Longsword',
      category: "Mixed & Men's Steel Longsword",
      rank: 523,
      weightedRating: 1532.6,
      lastCompeted: '2025-10-01',
    });
    expect(parsed.ratings.map((rating) => rating.weapon)).toEqual([
      'Longsword',
      'Sabre',
      'Rapier and Dagger',
      'Single Rapier',
      'Sword and Buckler',
      'Sidesword',
    ]);
  });

  it('parses HEMA detail HTML rating rows with weighted rating and last competed month', () => {
    const parsed = parseHemaRatingsDetailHtml(
      '10458',
      `
      <h2>Steven Gallagher</h2>
      <p>Club <a>Smart HEMA Clubs</a></p>
      <p>Nationality United Kingdom</p>
      <h3>Ratings</h3>
      <p>Category Rank (current) Weighted Rating (current) Rank (best) Weighted Rating (best)</p>
      <h4>Longsword</h4>
      <p>- <a>Mixed &amp; Men's Steel Longsword</a> 364 (top 5%) 1583.2 303 (November 2025) 1604.3 (November 2025)</p>
      <h4>Sword and Buckler</h4>
      <p>- <a>Mixed Steel Sword and Buckler</a> 163 (top 10%) 1512.4 163 (March 2026) 1520.3 (November 2025)</p>
      <h3>Full rating histories</h3>
      <h4>Mixed &amp; Men's Steel Longsword</h4>
      <p>February 2026</p><p>354</p><p>1585.8</p>
      <p>March 2026</p><p>364</p><p>1583.2</p>
      <h4>Mixed Steel Sword and Buckler</h4>
      <p>January 2026</p><p>163</p><p>1512.4</p>
      `,
    );

    expect(parsed).toEqual({
      id: '10458',
      name: 'Steven Gallagher',
      club: 'Smart HEMA Clubs',
      nationality: 'United Kingdom',
      detailsUrl: 'https://hemaratings.com/fighters/details/10458/',
      ratings: [
        {
          weapon: 'Longsword',
          category: "Mixed & Men's Steel Longsword",
          rank: 364,
          weightedRating: 1583.2,
          lastCompeted: '2026-03-01',
        },
        {
          weapon: 'Sword and Buckler',
          category: 'Mixed Steel Sword and Buckler',
          rank: 163,
          weightedRating: 1512.4,
          lastCompeted: '2026-01-01',
        },
      ],
    });
  });

  it('returns top 5 matches from latest snapshot', async () => {
    const fighters = [
      { id: 101, name: 'Jean Dupont', club: 'Lyon AMHE' },
      { id: 102, name: 'Jean Martin', club: 'Cercle PRMD' },
      { id: 103, name: 'Marie Dupont', club: 'Lyon AMHE' },
      { id: 104, name: 'John Dupond', club: 'London HEMA' },
      { id: 105, name: 'Jeanne Dupoix', club: 'Paris HEMA' },
      { id: 106, name: 'Jean Other', club: 'Other Club' },
      { id: 107, name: 'Unrelated Person', club: 'Other Club' },
    ];
    const from = vi
      .fn()
      .mockReturnValue(makeLatestSnapshotChain({ data: { fighters }, error: null }));
    const service = new HemaRatingsService({ service: { from } } as never);

    const results = await service.search('jean dupont', 5);

    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({
      id: '101',
      name: 'Jean Dupont',
      club: 'Lyon AMHE',
      // Snapshot entries here have no nationality and fetch is stubbed to
      // fail in tests — degrades silently to null per design.
      nationality: null,
      detailsUrl: 'https://hemaratings.com/fighters/details/101/',
    });
    expect(results.map((r) => r.id)).not.toContain('107');
  });

  it('returns cached nationality from the snapshot without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const fighters = [
      { id: 10458, name: 'Steven Gallagher', club: 'Smart HEMA Clubs', nationality: 'Ireland' },
    ];
    const from = vi
      .fn()
      .mockReturnValue(makeLatestSnapshotChain({ data: { fighters }, error: null }));
    const service = new HemaRatingsService({ service: { from } } as never);

    const results = await service.search('Gallagher', 5);

    expect(results).toEqual([
      {
        id: '10458',
        name: 'Steven Gallagher',
        club: 'Smart HEMA Clubs',
        nationality: 'Ireland',
        detailsUrl: 'https://hemaratings.com/fighters/details/10458/',
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('syncByHemaRatingsId fetches the profile and patches the snapshot', async () => {
    const html = `
      <h1>Anthony Garnier</h1>
      <table>
        <tbody>
          <tr><td>Club</td><td>Lyon AMHE</td></tr>
          <tr><td>Nationality</td><td>France</td></tr>
        </tbody>
      </table>
      <h3>Ratings</h3>
      <table>
        <tbody>
          <tr><td><strong>Longsword</strong></td></tr>
          <tr><td>- Mixed Steel Longsword</td><td>October 2025</td><td>500</td><td>1500</td><td>400</td><td>1550</td></tr>
        </tbody>
      </table>
    `;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(html) }),
    );
    const chain = makeReadWriteSnapshotChain({
      data: { id: 'snap-1', fighters: [{ id: 6282, name: 'Old' }] },
      error: null,
    });
    const from = vi.fn().mockReturnValue(chain);
    const service = new HemaRatingsService({ service: { from } } as never);

    await service.syncByHemaRatingsId('6282');

    expect(chain.update).toHaveBeenCalledTimes(1);
    const [updatePayload] = chain.update.mock.calls[0] as [{ fighters: unknown[] }];
    expect(updatePayload.fighters).toEqual([
      expect.objectContaining({ id: 6282, name: 'Anthony Garnier', nationality: 'France' }),
    ]);
  });

  it('syncByHemaRatingsId swallows upstream failures (fire-and-forget contract)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const from = vi.fn().mockReturnValue(makeLatestSnapshotChain({ data: null, error: null }));
    const service = new HemaRatingsService({ service: { from } } as never);

    await expect(service.syncByHemaRatingsId('6282')).resolves.toBeUndefined();
  });

  it('returns empty list when no snapshot exists', async () => {
    const from = vi.fn().mockReturnValue(makeLatestSnapshotChain({ data: null, error: null }));
    const service = new HemaRatingsService({ service: { from } } as never);

    await expect(service.search('jean', 5)).resolves.toEqual([]);
  });

  it('returns enriched HEMA profile by id from latest snapshot', async () => {
    const fighters = [
      {
        id: 10458,
        name: 'Steven Gallagher',
        club: 'Smart HEMA Clubs',
        detailsUrl: 'https://hemaratings.com/fighters/details/10458/',
        ratings: [
          {
            weapon: 'Longsword',
            category: "Mixed & Men's Steel Longsword",
            rank: 364,
            weightedRating: 1583.2,
            lastCompeted: '2026-03-01',
          },
        ],
      },
    ];
    const from = vi.fn().mockReturnValue(
      makeLatestSnapshotChain({
        data: { synced_at: '2026-05-02T00:00:00.000Z', fighters },
        error: null,
      }),
    );
    const service = new HemaRatingsService({ service: { from } } as never);

    await expect(service.getProfile('10458')).resolves.toEqual({
      id: '10458',
      name: 'Steven Gallagher',
      club: 'Smart HEMA Clubs',
      nationality: null,
      detailsUrl: 'https://hemaratings.com/fighters/details/10458/',
      syncedAt: '2026-05-02T00:00:00.000Z',
      ratings: [
        {
          weapon: 'Longsword',
          category: "Mixed & Men's Steel Longsword",
          rank: 364,
          weightedRating: 1583.2,
          lastCompeted: '2026-03-01',
        },
      ],
    });
  });

  it('resolves same-weapon weighted ratings and ignores stale rows', async () => {
    const fighters = [
      {
        id: 1,
        ratings: [
          {
            weapon: 'Longsword',
            category: 'Open',
            rank: 10,
            weightedRating: 1500,
            lastCompeted: '2026-01-01',
          },
          {
            weapon: 'Sabre',
            category: 'Open',
            rank: 1,
            weightedRating: 1900,
            lastCompeted: '2026-01-01',
          },
        ],
      },
      {
        id: 2,
        ratings: [
          {
            weapon: 'Longsword',
            category: 'Open',
            rank: 20,
            weightedRating: 1600,
            lastCompeted: '2022-01-01',
          },
        ],
      },
    ];
    const from = vi
      .fn()
      .mockReturnValue(makeLatestSnapshotChain({ data: { fighters }, error: null }));
    const service = new HemaRatingsService({ service: { from } } as never);

    const resolved = await service.resolveWeightedRatings(['1', '2'], 'long sword', {
      now: new Date('2026-05-02T00:00:00.000Z'),
    });

    expect(resolved.get('1')).toBe(1500);
    expect(resolved.has('2')).toBe(false);
  });

  // ── Admin surface ────────────────────────────────────────────────────────

  describe('admin surface', () => {
    function makeFromMock(tableHandlers: Record<string, () => unknown>) {
      return vi.fn((table: string) => {
        const handler = tableHandlers[table];
        if (!handler) throw new Error(`Unexpected supabase.from('${table}') in test`);
        return handler();
      });
    }

    it('listTrackedFighters joins global_persons with the latest snapshot ratings', async () => {
      const personsRows = [
        {
          id: 'gp-1',
          slug: 'jean-dupont',
          display_name: 'Jean Dupont',
          given_name: 'Jean',
          family_name: 'Dupont',
          hema_ratings_id: '6282',
          photo_url: null,
          club_id: 'club-1',
          clubs: { name: 'Lyon AMHE' },
        },
      ];
      const snapshot = {
        synced_at: '2026-05-25T00:00:00.000Z',
        fighters: [
          {
            id: 6282,
            name: 'Jean Dupont',
            club: 'Lyon AMHE',
            nationality: 'France',
            ratings: [
              {
                weapon: 'Longsword',
                category: 'Mixed',
                rank: 523,
                weightedRating: 1532.6,
                lastCompeted: '2025-10-01',
              },
              {
                weapon: 'Sabre',
                category: 'Mixed',
                rank: 896,
                weightedRating: 1286.9,
                lastCompeted: '2024-11-01',
              },
            ],
          },
        ],
      };

      const personsChain = {
        select: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: personsRows, error: null }),
      };
      const from = makeFromMock({
        global_persons: () => personsChain,
        hema_ratings_snapshots: () => makeLatestSnapshotChain({ data: snapshot, error: null }),
      });
      const service = new HemaRatingsService({ service: { from } } as never);

      const result = await service.listTrackedFighters();
      expect(result).toHaveLength(1);
      expect(result[0]!.globalPersonId).toBe('gp-1');
      expect(result[0]!.hemaRatingsId).toBe('6282');
      expect(result[0]!.clubName).toBe('Lyon AMHE');
      expect(result[0]!.ratings).toHaveLength(2);
      expect(result[0]!.lastCompeted).toBe('2025-10-01');
      expect(result[0]!.profileMissing).toBe(false);
      expect(result[0]!.syncedAt).toBe('2026-05-25T00:00:00.000Z');
    });

    it('listTrackedFighters flags profileMissing when no snapshot row matches the hema_ratings_id', async () => {
      const personsChain = {
        select: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'gp-2',
              slug: null,
              display_name: 'Marie Curie',
              given_name: 'Marie',
              family_name: 'Curie',
              hema_ratings_id: '99999',
              photo_url: null,
              club_id: null,
              clubs: null,
            },
          ],
          error: null,
        }),
      };
      const from = makeFromMock({
        global_persons: () => personsChain,
        hema_ratings_snapshots: () =>
          makeLatestSnapshotChain({
            data: { synced_at: '2026-05-25T00:00:00.000Z', fighters: [] },
            error: null,
          }),
      });
      const service = new HemaRatingsService({ service: { from } } as never);

      const result = await service.listTrackedFighters();
      expect(result[0]!.profileMissing).toBe(true);
      expect(result[0]!.ratings).toEqual([]);
      expect(result[0]!.lastCompeted).toBeNull();
    });

    it('listTrackedFighters returns an empty array when no global_persons are tracked', async () => {
      const personsChain = {
        select: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      const from = makeFromMock({ global_persons: () => personsChain });
      const service = new HemaRatingsService({ service: { from } } as never);

      await expect(service.listTrackedFighters()).resolves.toEqual([]);
    });

    it('getSyncHistory returns rows ordered newest first', async () => {
      const rows = [
        { id: 'snap-2', synced_at: '2026-05-25T03:30:00.000Z', fighter_count: 31_204 },
        { id: 'snap-1', synced_at: '2026-05-24T03:30:00.000Z', fighter_count: 31_198 },
      ];
      const historyChain = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
      };
      const from = makeFromMock({ hema_ratings_snapshots: () => historyChain });
      const service = new HemaRatingsService({ service: { from } } as never);

      const result = await service.getSyncHistory(5);
      expect(historyChain.limit).toHaveBeenCalledWith(5);
      expect(result).toEqual([
        { id: 'snap-2', syncedAt: '2026-05-25T03:30:00.000Z', fighterCount: 31_204 },
        { id: 'snap-1', syncedAt: '2026-05-24T03:30:00.000Z', fighterCount: 31_198 },
      ]);
    });

    it('enqueueSync adds a job onto the BullMQ queue', async () => {
      const queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
      const service = new HemaRatingsService(
        { service: { from: vi.fn() } } as never,
        queue as never,
      );

      const result = await service.enqueueSync('actor-1');
      expect(queue.add).toHaveBeenCalledWith(
        'sync',
        expect.objectContaining({ triggeredBy: 'actor-1' }),
        expect.objectContaining({ removeOnComplete: 10 }),
      );
      expect(result).toEqual({ jobId: 'job-1' });
    });

    it('enqueueSync throws when no queue is injected', async () => {
      const service = new HemaRatingsService({ service: { from: vi.fn() } } as never);
      await expect(service.enqueueSync('actor-1')).rejects.toThrow(/queue is not available/);
    });

    it('refreshSingleFighter rejects when the global person has no hema_ratings_id', async () => {
      const personChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'gp-3', hema_ratings_id: null },
          error: null,
        }),
      };
      const from = makeFromMock({ global_persons: () => personChain });
      const service = new HemaRatingsService({ service: { from } } as never);

      await expect(service.refreshSingleFighter('gp-3')).rejects.toThrow(/no hema_ratings_id/);
    });

    it('checkHealth returns latency + status from a successful probe', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: true, status: 200 } as unknown as Response);

      const service = new HemaRatingsService({ service: { from: vi.fn() } } as never);
      const result = await service.checkHealth();
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(typeof result.latencyMs).toBe('number');
      fetchSpy.mockRestore();
    });

    it('checkHealth returns ok=false + error when the upstream throws', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));

      const service = new HemaRatingsService({ service: { from: vi.fn() } } as never);
      const result = await service.checkHealth();
      expect(result.ok).toBe(false);
      expect(result.status).toBeNull();
      expect(result.error).toContain('socket hang up');
      fetchSpy.mockRestore();
    });
  });
});
