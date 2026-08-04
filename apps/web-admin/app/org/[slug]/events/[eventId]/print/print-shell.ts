/**
 * The document shell every sheet lives in: page size, print CSS, the per-sheet
 * header, and the page breaks between sheets.
 *
 * Kept apart from the sheet builders so there is one place that decides what a
 * printed page looks like. The alternative — each builder emitting its own
 * `<style>` — is how you end up with a pool sheet that fits A4 and a scoresheet
 * that spills onto a second page nobody notices until the morning of.
 */
import { escapeHtml } from '@myclash/types';
import type { PrintLabels, PrintTournamentMeta } from './print-types';

/**
 * `page-break-after: always` on every sheet but the last. `:last-child` would
 * be wrong: a trailing break prints one blank sheet per pack, and on a venue
 * printer nobody notices until they are standing at it.
 */
const PRINT_CSS = `
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; color: #111; margin: 0; }
  .sheet { page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  .sheet-head { display: flex; justify-content: space-between; align-items: flex-start;
                border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
  .sheet-head h1 { font-size: 16px; margin: 0 0 2px; }
  .sheet-head .meta { font-size: 10px; color: #555; text-align: right; line-height: 1.5; }
  h2 { font-size: 13px; margin: 14px 0 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f1f1; font-weight: 600; }
  td.box { height: 26px; }
  td.narrow { width: 56px; }
  td.center { text-align: center; }
  .corner { display: inline-block; width: 9px; height: 9px; border-radius: 2px;
            margin-right: 5px; vertical-align: -1px; }
  .sig { margin-top: 14px; font-size: 11px; }
  .sig .line { border-bottom: 1px solid #111; display: inline-block;
               width: 220px; margin-left: 8px; }
  /* Printers routinely drop background colours; the corner swatch IS the
     identification a scorekeeper reads, so force it to survive. */
  @media print { .corner { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

/** One sheet's header — the same four facts on every page of the pack. */
export function sheetHead(
  title: string,
  meta: PrintTournamentMeta,
  labels: PrintLabels,
  subtitle?: string,
): string {
  return (
    `<div class="sheet-head"><div><h1>${escapeHtml(title)}</h1>` +
    (subtitle ? `<div style="font-size:11px;color:#555">${escapeHtml(subtitle)}</div>` : '') +
    `</div><div class="meta">${escapeHtml(meta.eventName)}<br>` +
    `${escapeHtml(meta.tournamentName)} · ${escapeHtml(meta.rulesetLabel)}<br>` +
    `${escapeHtml(labels.generatedAt)} ${escapeHtml(meta.generatedAt)}</div></div>`
  );
}

/** A corner swatch in the organiser's configured colour, never a hardcoded red. */
export function cornerSwatch(color: string): string {
  return `<span class="corner" style="background:${escapeHtml(color)}"></span>`;
}

/** Wrap finished sheets into one printable document. */
export function printDocument(title: string, sheets: readonly string[]): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head>` +
    `<body>${sheets.join('')}</body></html>`
  );
}
