import { escapeHtml } from '@myclash/types';
import { printDocument } from '../print/print-shell';

export interface PhotoPosterInput {
  eventName: string;
  /** The on-screen QR code's `<svg>` markup: drawn by `qrcode.react`, never from user text. */
  qrSvg: string;
  /** The upload link, printed under the code for a phone that cannot scan. */
  address: string;
  labels: { title: string; scan: string };
}

/** The code fills its printed box: the on-screen size attributes give way to 100%. */
function scaled(svg: string): string {
  return svg.replace(
    /<svg([^>]*)>/,
    (_tag, attrs: string) =>
      `<svg width="100%" height="100%"${attrs.replace(/\s(?:width|height)="[^"]*"/g, '')}>`,
  );
}

/**
 * The A4 poster an organiser pins up at the venue: the Event, a large QR code of the photo link,
 * one line telling people what it does. Printed through the shared print shell, so it gets the
 * same page size and margins as every other sheet.
 *
 * The QR code stays dark on white whatever the theme, or a phone camera will not read it.
 */
export function photoPosterHtml({ eventName, qrSvg, address, labels }: PhotoPosterInput): string {
  const sheet =
    `<div class="sheet" style="text-align:center;padding-top:20mm">` +
    `<h1 style="font-size:28px;margin:0 0 6mm">${escapeHtml(eventName)}</h1>` +
    `<p style="font-size:20px;margin:0 0 10mm">${escapeHtml(labels.scan)}</p>` +
    `<div style="width:120mm;height:120mm;margin:0 auto;background:#fff">${scaled(qrSvg)}</div>` +
    `<p style="font-size:12px;color:#555;margin-top:8mm;word-break:break-all">${escapeHtml(address)}</p>` +
    `</div>`;
  return printDocument(labels.title, [sheet]);
}
