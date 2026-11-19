import { describe, expect, it } from 'vitest';
import { createTranslator, getMessages } from '@myclash/i18n';
import { detailLine } from './report-detail';

/**
 * Ruling 891: the debrief's supporting lines were English sentences built by the server, so a
 * French organiser read "unlabelled device: 3 refused, 1 still held (sequence)". The server now
 * sends data, and the page words it in the reader's language.
 */
const fr = createTranslator(getMessages('fr'));

describe('detailLine, in French', () => {
  it('words a device that lost hits, its refusal reasons named', () => {
    const line = detailLine(
      'refusedExchanges',
      { kind: 'refusedDevice', label: null, refused: 3, stillHeld: 1, reasons: ['sequence'] },
      fr,
    );
    expect(line).toBe("Appareil sans nom — refusés : 3 · encore en attente : 1 (conflit d'ordre)");
  });

  it('leaves out "still held" for a device that recovered', () => {
    const line = detailLine(
      'refusedExchanges',
      { kind: 'refusedDevice', label: 'Tablette 1', refused: 2, stillHeld: 0, reasons: [] },
      fr,
    );
    expect(line).toBe('Tablette 1 — refusés : 2');
  });

  it('names an override reason and an arrival as the rest of the app does', () => {
    expect(detailLine('overrides', { kind: 'tally', code: 'injury', count: 2 }, fr)).toBe(
      'Blessure : 2',
    );
    expect(detailLine('arrivals', { kind: 'tally', code: 'qr', count: 5 }, fr)).toBe(
      'Pass scanné : 5',
    );
  });

  it('shows a code it does not know yet as it came, rather than nothing', () => {
    expect(detailLine('overrides', { kind: 'tally', code: 'new_reason', count: 1 }, fr)).toBe(
      'new_reason : 1',
    );
  });
});
