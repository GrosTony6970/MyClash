import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TvProtestChip } from './TvProtestChip';
import type { MatchProtest } from '../types/match-events';

/**
 * The scoreboard's protest chip: the count beside the card chips, `count/limit`
 * with a limit, in the warning colour from the limit on. `FighterColumn` is
 * private and a static render runs no effects, so the chip is read on its own.
 */

const say = (key: string, params?: Record<string, string>) =>
  `<${key}${params?.fighter ? `:${params.fighter}` : ''}>`;

function protest(id: string, registrationId: string, voided = false): MatchProtest {
  return {
    id,
    client_uuid: id,
    match_id: 'm1',
    registration_id: registrationId,
    team_id: null,
    sequence: 1,
    round_number: 1,
    clock_time_ms: 1000,
    occurred_at: '2026-11-17T10:00:00Z',
    voided,
  };
}

const protests = [
  protest('a', 'red'),
  protest('b', 'red'),
  protest('c', 'red', true),
  protest('d', 'blue'),
  protest('e', 'blue'),
  protest('f', 'blue'),
];

function render(limit: number | null, registrationId = 'red'): string {
  return renderToStaticMarkup(
    <TvProtestChip
      protests={protests}
      registrationId={registrationId}
      limit={limit}
      fighterName="Ada"
      t={say}
    />,
  );
}

const text = (html: string) => html.replace(/<[^>]*>/g, '');

describe('TvProtestChip', () => {
  it('counts the fighter protests that are not voided', () => {
    expect(text(render(null))).toBe('2');
  });

  it('does not count the other fighter protests', () => {
    expect(text(render(null, 'blue'))).toBe('3');
  });

  it('shows count/limit with the neutral tokens below the limit', () => {
    const html = render(5);
    expect(text(html)).toBe('2/5');
    expect(html).toContain('bg-stage-foreground/10');
    expect(html).not.toContain('text-warning');
  });

  it('turns to the warning tokens at the limit', () => {
    const html = render(2);
    expect(text(html)).toBe('2/2');
    expect(html).toContain('text-warning');
    expect(html).toContain('bg-warning/20');
  });

  // The stage sets no scope, so a bare `text-warning` is the light page's amber on near-black.
  // At the limit the chip takes the dark scope's, 6.90:1 on its fill (known-deviations D34).
  it('takes the dark scope at the limit, so its warning is the bright amber', () => {
    expect(render(2)).toContain('data-theme="dark"');
    expect(render(5)).not.toContain('data-theme');
  });

  it('names the fighter in the tooltip and uses tokens only', () => {
    const html = render(2);
    expect(html).toContain('title="&lt;scoring.lice.protestsChipTooltip:Ada&gt;"');
    expect(html).not.toMatch(/(?:bg|text|border)-(?:red|blue|amber|yellow|gray|white|black)\b/);
  });

  it('fades at zero like the card chips, and the warning wins at a limit of 0', () => {
    const none = renderToStaticMarkup(
      <TvProtestChip protests={[]} registrationId="red" limit={null} fighterName="Ada" t={say} />,
    );
    expect(none).toContain('opacity-30');
    expect(text(none)).toBe('0');
    const zeroLimit = renderToStaticMarkup(
      <TvProtestChip protests={[]} registrationId="red" limit={0} fighterName="Ada" t={say} />,
    );
    expect(text(zeroLimit)).toBe('0/0');
    expect(zeroLimit).toContain('text-warning');
    expect(zeroLimit).not.toContain('opacity-30');
  });
});
