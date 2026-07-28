import { describe, it, expect } from 'vitest';
import type { CompensationReport } from '@myclash/types';
import { compensationToCsv, compensationToPrintHtml } from './compensation-export';

function makeReport(): CompensationReport {
  return {
    planId: 'p1',
    planName: 'FFAMHE',
    maxCap: null,
    minFloor: null,
    grandTotal: 30,
    referees: [
      {
        userId: 'u1',
        displayName: 'Alice, "Ace"',
        totalTokens: 12,
        amountOwed: 10,
        paid: true,
        paidAt: null,
        breakdown: [
          {
            phase: 'pool',
            role: 'arbitre_declarant',
            matchCount: 3,
            tokensPerMatch: 2,
            subtotal: 6,
          },
          {
            phase: 'bracket',
            role: 'arbitre_declarant',
            matchCount: 2,
            tokensPerMatch: 3,
            subtotal: 6,
          },
        ],
      },
      {
        userId: 'u2',
        displayName: 'Bob',
        totalTokens: 20,
        amountOwed: 20,
        paid: false,
        paidAt: null,
        breakdown: [
          { phase: 'finals', role: 'custom-abc', matchCount: 5, tokensPerMatch: 4, subtotal: 20 },
        ],
      },
    ],
  };
}

describe('compensationToCsv', () => {
  it('emits a header, one row per referee, and a grand-total row', () => {
    const lines = compensationToCsv(makeReport()).split('\r\n');
    expect(lines[0]).toBe('Referee,Pool,Bracket,Finals,Total tokens,Amount (EUR),Paid');
    expect(lines).toHaveLength(4); // header + 2 referees + total
    expect(lines[3]).toBe('Total,,,,,30.00,');
  });

  it('splits phase tokens into columns and escapes commas/quotes per RFC 4180', () => {
    const alice = compensationToCsv(makeReport()).split('\r\n')[1];
    // name (comma+quotes → quoted/doubled), pool 6.0, bracket 6.0, finals 0.0,
    // total 12.0, amount 10.00, paid Yes
    expect(alice).toBe('"Alice, ""Ace""",6.0,6.0,0.0,12.0,10.00,Yes');
  });

  it('neutralises a spreadsheet formula planted in a referee name', () => {
    // Referee names come from the roster, which organisers type and import.
    const report = makeReport();
    report.referees[0]!.displayName = '=cmd|calc';
    expect(compensationToCsv(report)).toContain('"\'=cmd|calc"');
  });

  it('keeps amounts numeric so the EUR column still sums', () => {
    // The first thing anyone does with this file is total the amount column.
    expect(compensationToCsv(makeReport())).toContain(',10.00,');
  });

  it('emits header + a zeroed total row for an empty report', () => {
    const empty = { ...makeReport(), referees: [], grandTotal: 0 };
    const lines = compensationToCsv(empty).split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('Total,,,,,0.00,');
  });
});

describe('compensationToPrintHtml', () => {
  it('produces a full HTML doc with the localized title and a total row', () => {
    const html = compensationToPrintHtml('Compensation — Test', makeReport());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Compensation — Test</title>');
    expect(html).toContain('<td class="r">20.00</td>');
    expect(html).toContain('tr.total');
  });

  it('escapes HTML in referee names', () => {
    const report = makeReport();
    report.referees[0]!.displayName = '<b>x</b>';
    const html = compensationToPrintHtml('t', report);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});
