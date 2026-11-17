import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './StatusBadge';

/**
 * A live status says so with a pulsing dot, and its words stay still. The whole chip used to pulse:
 * at the faint end of the beat a "Running" pill was 2.7:1, and the browser accessibility suite
 * caught it on an Event's home page (known-deviations D35). The dot is guarded for people who asked
 * for less motion.
 */
describe('StatusBadge', () => {
  it('pulses a dot for a live status, not the words', () => {
    const html = renderToStaticMarkup(<StatusBadge semantic="live">Running</StatusBadge>);
    const chip = /^<span class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(chip).not.toContain('animate-pulse');
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*motion-safe:animate-pulse[^"]*"><\/span>/,
    );
    expect(html).toContain('Running');
  });

  it('draws no dot for a status that is not live', () => {
    const html = renderToStaticMarkup(<StatusBadge semantic="ready">Ready</StatusBadge>);
    expect(html).not.toContain('animate-pulse');
    expect(html).not.toContain('aria-hidden');
  });
});
