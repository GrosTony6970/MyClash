import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n/I18nProvider';
import type { ReadinessReport } from '../readiness-copy';
import { PublishReadinessDialog } from './PublishReadinessDialog';

/**
 * The publish dialog lists the checks still outstanding. It marks their level with the same
 * solid mark as Start of day: its own copy of the old dot used the pale chip palette and read
 * as white.
 */
const REPORT: ReadinessReport = {
  eventId: 'ev1',
  eventStatus: 'draft',
  tournaments: [{ id: 't1', name: 'Longsword' }],
  checks: [
    { key: 'poolReferees', level: 'critical', tournamentId: 't1', values: { missing: 2 } },
    { key: 'pools', level: 'ok', tournamentId: 't1', values: { count: 4 } },
  ],
  worst: 'critical',
  counts: { ok: 1, warn: 0, critical: 1, info: 0 },
};

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('PublishReadinessDialog', () => {
  it('marks an outstanding check with the solid mark, not the pale dot', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <I18nProvider locale="en">
          <PublishReadinessDialog
            open
            report={REPORT}
            busy={false}
            onCancel={() => undefined}
            onConfirm={() => undefined}
          />
        </I18nProvider>,
      );
    });

    const marks = [...document.body.querySelectorAll('[role="img"]')];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.className).toContain('bg-danger');
    expect(marks[0]?.className).not.toMatch(/-(50|100|200)\b/);
    expect(marks[0]?.textContent).toBe('✕');
  });
});
