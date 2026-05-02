import { describe, expect, it, vi } from 'vitest';
import { HemaRatingsService } from './hema-ratings.service';

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
});
