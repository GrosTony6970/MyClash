// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../src/i18n/I18nProvider';
import { WorkshopIntro } from './WorkshopIntro';
import type { Instructor, Workshop } from './workshop-view';

/**
 * What the public Workshop page says before its sessions (slice 3.6): its picture, its weapon,
 * what to know or bring, and a card per instructor with what the API says about them.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const paul: Instructor = {
  globalPersonId: 'gp-paul',
  displayName: 'Paul Martin',
  about: {
    bio: '15 years of dagger',
    club: 'Salle Lyon',
    photoUrl: '/storage/v1/object/public/workshop-assets/paul.jpg',
  },
};
const lea: Instructor = { globalPersonId: 'gp-lea', displayName: 'Léa Roux' };

const workshop = (over: Partial<Workshop> = {}): Workshop => ({
  id: 'w-1',
  slug: 'dagger',
  title: 'Dagger intro',
  shortDescription: null,
  descriptionMd: 'Grips and guards.',
  prerequisites: 'Bring a mask',
  category: null,
  level: 'beginner',
  weapon: 'Dagger',
  language: 'fr',
  color: null,
  coverImageUrl: '/storage/v1/object/public/workshop-assets/dagger.png',
  durationMinutes: 90,
  eventTimezone: 'Europe/Paris',
  sessions: [],
  instructors: [paul, lea],
  viewerIsInstructor: false,
  ...over,
});

function show(w: Workshop) {
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <WorkshopIntro workshop={w} />
      </I18nProvider>,
    );
  });
}
const text = () => container.textContent ?? '';
const images = () => [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

describe('WorkshopIntro', () => {
  it('shows the picture, the weapon and what to know or bring', () => {
    // A weapon named nowhere else on the page: only its tag can show it.
    show(workshop({ weapon: 'Rondel' }));
    expect(images()).toContain('/storage/v1/object/public/workshop-assets/dagger.png');
    expect(text()).toContain('Rondel');
    expect(text()).toContain('Before you come');
    expect(text()).toContain('Bring a mask');
    expect(text()).toContain('Grips and guards.');
  });

  it('leaves out what the Workshop does not say', () => {
    show(workshop({ title: 'Knife work', coverImageUrl: null, weapon: null, prerequisites: null }));
    expect(images()).not.toContain('/storage/v1/object/public/workshop-assets/dagger.png');
    expect(text()).not.toContain('Dagger');
    expect(text()).not.toContain('Before you come');
  });

  it('draws a card per instructor: photo, name, club and bio', () => {
    show(workshop());
    const cards = [...container.querySelectorAll('li')];
    expect(text()).toContain('Instructors');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Salle Lyon');
    expect(cards[0]?.textContent).toContain('15 years of dagger');
    expect(images()).toContain('/storage/v1/object/public/workshop-assets/paul.jpg');
    // Nothing said about Léa: her card holds her name only.
    expect(cards[1]?.textContent).toBe('LRLéa Roux');
  });

  it('draws no instructor cards when nothing is said about anybody', () => {
    show(workshop({ instructors: [lea, { globalPersonId: null, displayName: 'Guest' }] }));
    expect(text()).not.toContain('Instructors');
    expect(container.querySelectorAll('li')).toHaveLength(0);
    // The names line under the title stays.
    expect(text()).toContain('Léa Roux, Guest');
  });
});
