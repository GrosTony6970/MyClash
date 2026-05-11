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
