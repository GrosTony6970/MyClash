// Explicit React import: this app's vitest transform uses the classic JSX
// runtime, so JSX compiles to `React.createElement` and needs the binding.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RulesetDiscoverCard } from './RulesetDiscoverCard';

/**
 * A Discover card shows lineage lamps for an adoptable ruleset. The lamps are
 * SERVER-computed and passed in whole — the card never derives them, because a
 * client only ever sees raw columns and a lamp that disagrees with the content
 * hash is worse than no lamp at all.
 *
 * What matters here is that the card renders the signal it is given (including
 * the ranking guardrail), and renders nothing at all when there is no lineage —
 * which is the common case, since most catalog rows reuse nothing.
 */
const BASE_PROPS = {
  name: 'Org X Rules',
  version: '1.0.0',
  description: null,
  isBuiltIn: false,
  ownerOrganizationName: 'Org X',
  adoptHref: '/org/demo/rulesets/scoring/new?cloneFrom=r1',
  viewHref: '/org/demo/rulesets/scoring/r1/edit',
};

describe('RulesetDiscoverCard lineage lamps', () => {
  it('renders no lamps for a ruleset that reuses nothing', () => {
    const html = renderToStaticMarkup(<RulesetDiscoverCard {...BASE_PROPS} />);

    expect(html).not.toContain('Compared with');
    expect(html).not.toContain('bg-success');
  });

  it('renders three lamps and no guardrail when only the grammar diverges', () => {
    const html = renderToStaticMarkup(
      <RulesetDiscoverCard
        {...BASE_PROPS}
        lineage={{
          base: 'TF v1',
          diff: {
            grammar: 'changed',
            endConditions: 'unchanged',
            ranking: 'unchanged',
            rankingCompatible: true,
          },
        }}
      />,
    );

    expect(html).toContain('Compared with TF v1');
    expect(html).toContain('Grammar (targets, afterblow)');
    expect(html).toContain('Ranking (scoring)');
    // One amber dot (grammar), two green (end conditions, ranking).
    expect(html.match(/bg-warning(?!\/)/g) ?? []).toHaveLength(1);
    expect(html.match(/bg-success/g) ?? []).toHaveLength(2);
    // Ranking still compatible → placings warning stays away.
    expect(html).not.toContain('placings no longer match');
  });

  it('fires the ranking guardrail when ranking diverges', () => {
    const html = renderToStaticMarkup(
      <RulesetDiscoverCard
        {...BASE_PROPS}
        lineage={{
          base: 'TF v1',
          diff: {
            grammar: 'unchanged',
            endConditions: 'unchanged',
            ranking: 'changed',
            rankingCompatible: false,
          },
        }}
      />,
    );

    expect(html).toContain('placings no longer match TF v1');
  });

  it('renders the single penalty lamp for a penalty ruleset', () => {
    const html = renderToStaticMarkup(
      <RulesetDiscoverCard
        {...BASE_PROPS}
        lineage={{ base: 'FFAMHE penalties', status: 'changed' }}
      />,
    );

    expect(html).toContain('Compared with FFAMHE penalties');
    expect(html).toContain('Penalties (cards, forfeits)');
    // A penalty ruleset is a separate ruleset type, not a fourth scoring
    // bucket — it must never render the three scoring lamps.
    expect(html).not.toContain('Grammar (targets, afterblow)');
  });
});
