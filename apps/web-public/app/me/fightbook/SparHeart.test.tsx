// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import type { AgreedSpar } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../src/i18n/I18nProvider';
import { hearted } from './fightbook-patches';
import { MySparsTab } from './MySparsTab';
import type { FightBookData } from './use-fightbook';

/** Marc is Julie's partner on a spar card: the heart is there only when the API sends a value. */
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const marc = { globalPersonId: 'gp-marc', name: 'Marc Probe', photoUrl: null, club: null };
const spar = (partnerFavourite: boolean | null): AgreedSpar => ({
  id: 's-1',
  kind: 'free',
  eventName: null,
  day: '2026-05-23',
  time: null,
  place: 'Salle',
  weapons: ['Sabre'],
  partner: marc,
  iAsked: false,
  message: null,
  status: 'agreed',
  cancelledByMe: null,
  cancelMessage: null,
  markFrom: '2026-05-22T22:00:00.000Z',
  markUntil: '2026-05-26T04:00:00.000Z',
  cancelUntil: '2026-05-24T04:00:00.000Z',
  myReview: null,
  theirThanks: null,
  note: null,
  partnerFavourite,
});

let container: HTMLDivElement;
let root: Root;
const noop = vi.fn();
const onHearted = vi.fn();
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(apiRequest).mockResolvedValue({ ok: true, data: { items: [], more: false } } as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(apiRequest).mockReset();
  onHearted.mockReset();
});

async function show(partnerFavourite: boolean | null) {
  await act(async () =>
    root.render(
      <I18nProvider locale="en">
        <MySparsTab
          apiUrl="http://api.test"
          spars={{ spars: [spar(partnerFavourite)], sent: [] }}
          onHearted={onHearted}
          onCancelled={noop}
          onWithdrawn={noop}
          onMarked={noop}
          onUndone={noop}
          onReviewed={noop}
          onNoted={noop}
          onStale={noop}
        />
      </I18nProvider>,
    ),
  );
}
const heart = () => container.querySelector<HTMLButtonElement>('button[aria-pressed]');

describe('the partner heart on a spar card', () => {
  it('shows none when the API sends null', async () => {
    await show(null);
    expect(heart()).toBeNull();
  });

  it('shows the heart as the API sends it, and tells the page when it changes', async () => {
    await show(false);
    expect(heart()?.getAttribute('aria-label')).toBe('Add Marc Probe to favourites');
    await act(async () => heart()!.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(onHearted).toHaveBeenCalledWith('gp-marc', true);
  });
});

describe('the hearted patch', () => {
  const data = (p: boolean | null): FightBookData => ({
    settings: { hasProfile: true, enabled: true },
    inbox: [],
    spars: { spars: [spar(p)], sent: [] },
    blocks: [],
  });

  it('sets the heart on that partner’s spars, idempotently', () => {
    const once = { ...data(false), ...hearted('gp-marc', true)(data(false)) };
    const twice = { ...once, ...hearted('gp-marc', true)(once) };
    expect(twice.spars.spars[0]?.partnerFavourite).toBe(true);
  });

  it('leaves a null (no heart) and other partners alone', () => {
    expect(hearted('gp-marc', true)(data(null)).spars?.spars[0]?.partnerFavourite).toBeNull();
    expect(hearted('gp-other', true)(data(false)).spars?.spars[0]?.partnerFavourite).toBe(false);
  });
});
