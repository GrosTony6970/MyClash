import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InstallAppButton } from './InstallAppButton';
import { InstallOfferCapture } from './InstallOfferCapture';
import { LegalFooter } from './LegalFooter';
import { INSTALL_CAPTURE_SCRIPT } from '../hooks/install-offer';

describe('the install button on the server', () => {
  it('draws nothing: the server has no offer, so hydration has no mismatch', () => {
    expect(renderToStaticMarkup(<InstallAppButton label="Install the app" />)).toBe('');
  });

  it('leaves the footer as it was when there is no offer', () => {
    const links = [{ label: 'Terms', href: '/terms' }];
    expect(
      renderToStaticMarkup(
        <LegalFooter links={links} action={<InstallAppButton label="Install the app" />} />,
      ),
    ).toBe(renderToStaticMarkup(<LegalFooter links={links} />));
  });
});

describe('the capture', () => {
  it('is the inline script, unescaped', () => {
    expect(renderToStaticMarkup(<InstallOfferCapture />)).toBe(
      `<script>${INSTALL_CAPTURE_SCRIPT}</script>`,
    );
  });
});

describe('the footer action', () => {
  it('is drawn above the links', () => {
    const html = renderToStaticMarkup(
      <LegalFooter links={[{ label: 'Terms', href: '/terms' }]} action={<b>act</b>} />,
    );
    expect(html.indexOf('<b>act</b>')).toBeGreaterThan(-1);
    expect(html.indexOf('<b>act</b>')).toBeLessThan(html.indexOf('<ul'));
  });
});
