import { describe, expect, it, vi } from 'vitest';
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

describe('HemaRatingsService', () => {
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
      detailsUrl: 'https://hemaratings.com/fighters/details/101/',
    });
    expect(results.map((r) => r.id)).not.toContain('107');
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
});
