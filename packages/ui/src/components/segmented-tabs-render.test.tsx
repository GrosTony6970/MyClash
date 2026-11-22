import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SegmentedTabs } from './SegmentedTabs';

/**
 * A fighter opens one of her Events on a phone. Four tabs (Overview, Schedule, Workshops, Photos)
 * were wider than the screen: the last ran off the strip and pushed the whole page sideways.
 */
const LABELS = ['Overview', 'Schedule', 'Workshops', 'Photos'];

function render(): string {
  return renderToStaticMarkup(
    <SegmentedTabs
      value="overview"
      onChange={() => undefined}
      tabs={LABELS.map((label) => ({ value: label.toLowerCase(), label }))}
    />,
  );
}

/** The class list of every element with the given role, in order. */
function classesOf(html: string, role: string): string[] {
  return [...html.matchAll(new RegExp(`role="${role}"[^>]*class="([^"]*)"`, 'g'))].map(
    (m) => m[1]!,
  );
}

describe('SegmentedTabs', () => {
  it('scrolls inside its own track when the tabs are wider than the screen', () => {
    const [track] = classesOf(render(), 'tablist');
    expect(track).toContain('overflow-x-auto');
  });

  it('keeps each label on one line, with tighter padding on a phone', () => {
    const tabs = classesOf(render(), 'tab');
    expect(tabs).toHaveLength(LABELS.length);
    for (const tab of tabs) {
      expect(tab).toContain('whitespace-nowrap');
      expect(tab.split(' ')).toContain('px-2');
      expect(tab).toContain('sm:px-3');
    }
  });
});
