import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { apiRequest } from '@myclash/api-client';
import type { Translator } from '@myclash/next-i18n/client';
import type { ClashWorkshop } from './instructor-clashes';
import { useInstructorClashes, type BusyCheck } from './use-instructor-clashes';

/**
 * When the board reads the instructors' fights and refereeing (rulings 553-555): only while the
 * Schedule tab is shown, again when the instructors change, never letting a late answer of an
 * older read land, and never looking all clear before an answer.
 */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = ((key: string, values?: Record<string, unknown>) =>
  `${key.split('.').pop()}:${String(values?.name)}:${String(values?.against)}`) as Translator;

const paul = { globalPersonId: 'gp-paul', displayName: 'Paul' };
const marie = { globalPersonId: 'gp-marie', displayName: 'Marie' };
const dagger = (instructors: ClashWorkshop['instructors']): ClashWorkshop[] => [
  {
    title: 'Dagger intro',
    instructors,
    sessions: [{ id: 's-dg', startsAt: '2026-05-23T10:00:00Z', endsAt: '2026-05-23T11:00:00Z' }],
  },
];
const refereeing = (personId: string, label: string) => ({
  ok: true as const,
  data: {
    busy: [
      {
        personId,
        kind: 'referee',
        label,
        startsAt: '2026-05-23T10:00:00Z',
        endsAt: '2026-05-23T10:30:00Z',
      },
    ],
  },
});

/** Each read's answer, handed over when the test says. */
const pending: Array<(answer: unknown) => void> = [];
let seen: { lines: Map<string, string[]>; check: BusyCheck };
let root: Root;

function report(value: typeof seen) {
  seen = value;
}

function Probe(props: { enabled: boolean; workshops: ClashWorkshop[] }) {
  const value = useInstructorClashes('http://api.test', 'ev1', props.enabled, props.workshops, t);
  useEffect(() => report(value));
  return null;
}

async function render(enabled: boolean, workshops: ClashWorkshop[]) {
  await act(async () => root.render(<Probe enabled={enabled} workshops={workshops} />));
}

async function answer(index: number, value: unknown) {
  await act(async () => pending[index]!(value));
}

beforeEach(() => {
  pending.length = 0;
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(
    () => new Promise((resolve) => pending.push(resolve as (answer: unknown) => void)) as never,
  );
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
});

describe('useInstructorClashes', () => {
  it('reads nothing while the board is not shown', async () => {
    await render(false, dagger([paul]));

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('is checking until the answer arrives, then shows the clash', async () => {
    await render(true, dagger([paul]));

    expect(vi.mocked(apiRequest).mock.calls[0]![1]).toBe(
      '/api/v1/events/ev1/workshop-instructor-busy',
    );
    expect(seen.check).toBe('checking');
    expect(seen.lines.size).toBe(0);

    await answer(0, refereeing('gp-paul', 'LS · Pool 3'));

    expect(seen.check).toBe('checked');
    expect(seen.lines.get('s-dg')).toEqual(['refereesClash:Paul:LS · Pool 3']);
  });

  it('reads again when the instructors change, and drops the older answer that lands late', async () => {
    await render(true, dagger([paul]));
    await render(true, dagger([paul, marie]));

    expect(apiRequest).toHaveBeenCalledTimes(2);
    await answer(1, refereeing('gp-marie', 'Newer · Pool 1'));
    await answer(0, refereeing('gp-paul', 'Older · Pool 9'));

    expect(seen.check).toBe('checked');
    expect(seen.lines.get('s-dg')).toEqual(['refereesClash:Marie:Newer · Pool 1']);
  });

  it('is checking again after the instructors change, until the new answer', async () => {
    await render(true, dagger([paul]));
    await answer(0, refereeing('gp-paul', 'LS · Pool 3'));
    await render(true, dagger([paul, marie]));

    expect(seen.check).toBe('checking');
  });

  it('says it failed when the read fails, never all clear', async () => {
    await render(true, dagger([paul]));
    await answer(0, { ok: false, kind: 'network' });

    expect(seen.check).toBe('failed');
    expect(seen.lines.size).toBe(0);
  });
});
