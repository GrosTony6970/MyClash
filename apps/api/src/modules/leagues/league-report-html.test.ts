/**
 * `finalReportHtml` had no test at all, and that is how a third private
 * `escapeHtml` survived in `leagues.service.ts` escaping only `& < > "` while the
 * shared one in `@myclash/types` escapes `& < > " '`.
 *
 * The single quote is the whole point of this file. A test asserting only that
 * `<` becomes `&lt;` passes against BOTH implementations and would have proved
 * nothing — which is why the interesting assertions below name `'` specifically.
 */
import { describe, expect, it, vi } from 'vitest';
import { LeaguesService } from './leagues.service';

type Standings = Awaited<ReturnType<LeaguesService['standings']>>;

/** `finalReportHtml` reaches nothing but `this.standings`, so nothing else is wired. */
function serviceReporting(standings: unknown): LeaguesService {
  const service = new LeaguesService(
    null as never,
    null as never,
    null as never,
    undefined as never,
  );
  vi.spyOn(service, 'standings').mockResolvedValue(standings as Standings);
  return service;
}

const payload = (leagueName: string, fighterName: string) => ({
  league: { name: leagueName },
  rows: [
    {
      ranking_group_key: 'open',
      rank: 1,
      total_points: 42,
      global_person_id: 'person-1',
      global_persons: { display_name: fighterName },
    },
  ],
});

describe('finalReportHtml escaping', () => {
  it('escapes the single quote — the character the private escaper missed', async () => {
    const service = serviceReporting(payload("Ligue d'Occitanie", "Jeanne d'Arc"));

    const out = await service.finalReportHtml('league-1');

    expect(out).not.toContain("d'Occitanie");
    expect(out).not.toContain("d'Arc");
    expect(out).toContain('Ligue d&#39;Occitanie');
    expect(out).toContain('Jeanne d&#39;Arc');
  });

  it('escapes the other four, in both the title and the table body', async () => {
    const service = serviceReporting(payload('A & B <x>', '"Bob" & <b>Ann</b>'));

    const out = await service.finalReportHtml('league-1');

    expect(out).toContain('<title>A &amp; B &lt;x&gt;</title>');
    expect(out).toContain('&quot;Bob&quot; &amp; &lt;b&gt;Ann&lt;/b&gt;');
    expect(out).not.toContain('<b>Ann</b>');
  });

  it('renders non-string cells and a missing fighter without throwing', async () => {
    // The local escaper coerced with `String(value ?? '')`; the shared one takes a
    // string, so the wrapper owns that coercion now. Ranks and points are numbers,
    // and a row with no linked global_person falls back to its id.
    const service = serviceReporting({
      league: { name: 'Plain' },
      rows: [
        {
          ranking_group_key: 'open',
          rank: 2,
          total_points: 7,
          global_person_id: 'person-2',
          global_persons: null,
        },
      ],
    });

    const out = await service.finalReportHtml('league-1');

    expect(out).toContain('<td>2</td>');
    expect(out).toContain('<td>7</td>');
    expect(out).toContain('<td>person-2</td>');
  });
});
