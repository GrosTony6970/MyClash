import { describe, expect, it } from 'vitest';
import { photoPosterHtml } from './photo-poster';

// As `QRCodeSVG` draws it on screen: its own size attributes.
const QR = '<svg height="160" width="160" viewBox="0 0 29 29"><path d="M0 0h7v7H0z"/></svg>';

const poster = (eventName: string, address = 'https://app.test/e/open/photos/send') =>
  photoPosterHtml({
    eventName,
    qrSvg: QR,
    address,
    labels: { title: 'Photos poster', scan: 'Scan to send your photos' },
  });

describe('photoPosterHtml', () => {
  it('prints one A4 sheet with the Event, the line and the code, scaled to its box', () => {
    const html = poster('Open 2026');

    expect(html).toContain('@page { size: A4 portrait');
    expect(html.match(/class="sheet"/g)).toHaveLength(1);
    expect(html).toContain('<h1 style="font-size:28px;margin:0 0 6mm">Open 2026</h1>');
    expect(html).toContain('Scan to send your photos');
    expect(html).toContain('<svg width="100%" height="100%" viewBox="0 0 29 29">');
    expect(html).not.toContain('160');
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain('<title>Photos poster</title>');
  });

  it('escapes the Event name and the address: an organiser typed them', () => {
    const html = poster('<b>Open</b> & co', 'https://app.test/e/<x>');

    expect(html).toContain('&lt;b&gt;Open&lt;/b&gt; &amp; co');
    expect(html).toContain('https://app.test/e/&lt;x&gt;');
    expect(html).not.toContain('<b>Open</b>');
  });
});
