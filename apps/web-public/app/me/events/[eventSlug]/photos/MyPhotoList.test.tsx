// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MyPhoto } from '@myclash/types';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../src/i18n/I18nProvider';
import { MyPhotoList } from './MyPhotoList';

/**
 * Her photos' status (ruling 498): an approved photo reads "Approved", never "Shown", because it is
 * hidden from the public while the Event's photos are Off.
 */

const photo = (id: string, status: MyPhoto['status']): MyPhoto => ({
  id,
  status,
  caption: null,
  tag: null,
  createdAt: '2026-11-01T13:00:00+00:00',
  previewUrl: null,
  originalUrl: null,
});
const mine = {
  status: 'ready',
  photos: [photo('p1', 'approved'), photo('p2', 'waiting')],
  hasMore: false,
  loadingMore: false,
  moreFailed: false,
  removing: new Set<string>(),
  failedDelete: {},
} as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const statuses = () =>
  [...container.querySelectorAll('[data-testid="my-photo"] p.font-medium')].map(
    (p) => p.textContent,
  );

describe('MyPhotoList — the status of each photo', () => {
  it.each([
    ['en', ['Approved', 'Waiting for approval']],
    ['fr', ['Approuvée', 'En attente de validation']],
  ] as const)('reads Approved, never Shown (%s)', (locale, expected) => {
    act(() =>
      root.render(
        <I18nProvider locale={locale}>
          <MyPhotoList mine={mine} timeZone="Europe/Paris" />
        </I18nProvider>,
      ),
    );
    expect(statuses()).toEqual(expected);
  });
});
