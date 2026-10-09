import { act } from 'react';
import { expect } from 'vitest';
import type { OpenedPage } from '../../../archived-page.fixtures';

/**
 * A Tournament whose settings page DRAWS every control that saves: it has
 * drifted from its ruleset stamp, it has a logo, it sits on a built-in ruleset,
 * and each of its three phases has a venue.
 */
export const TOURNAMENT_ID = 't-1';
const TOURNAMENT = `/api/v1/tournaments/${TOURNAMENT_ID}`;
export const RECAP = `/api/v1/generated-content/tournament_recap/${TOURNAMENT_ID}`;

/** The row both the settings tabs and the wizard steps read. */
export const TOURNAMENT_ROW = {
  id: TOURNAMENT_ID,
  name: 'Longsword',
  slug: 'longsword',
  weapon: 'Longsword',
  color: null,
  status: 'draft',
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_is_system: true,
  ruleset_base_code: null,
  ruleset_grammar: { hasAfterblow: true, hasMaxDoubles: true },
  ruleset_config: {},
  scoring_config_json: {},
  lock_config: { autoLockEnabled: true },
  penalty_ruleset_id: 'pr-1',
  max_participants: null,
  max_waitlist: null,
  logo_url: 'http://img.test/logo.png',
};

/** What every tab and every step reads, by path. */
export const TOURNAMENT_READS: Record<string, unknown> = {
  [TOURNAMENT]: TOURNAMENT_ROW,
  [`${TOURNAMENT}/ruleset-drift`]: { drifted: true },
  [`${TOURNAMENT}/penalty-ruleset`]: {
    penalty_ruleset_entries: [
      { id: 'pe-1', ref_number: 1, short_name: 'Late', group_number: 1, sanctions: [] },
    ],
  },
  [`${TOURNAMENT}/phase-venues`]: {
    pool: { id: 'v-1' },
    swiss: { id: 'v-1' },
    bracket: { id: 'v-1' },
  },
  '/api/v1/events/ev1/venues': [
    { id: 'v-1', name: 'Hall A' },
    { id: 'v-2', name: 'Hall B' },
  ],
  '/api/v1/organizations/slug/org': { id: 'org-1' },
  '/api/v1/organizations/org-1/penalty-rulesets': [
    { id: 'pr-1', name: 'FFAMHE penalties', built_in: true },
    { id: 'pr-2', name: 'House rules' },
  ],
  '/api/v1/rulesets/for-event/ev1': [
    { code: 'TF_v1', version: '1.0.0', label: 'TF v1' },
    { code: 'Generic_PointsCap', version: '1.0.0', label: 'Points cap' },
  ],
  '/api/v1/weapons?active=true': [
    { id: 'w-1', slug: 'longsword', name: 'Longsword', active: true },
    { id: 'w-2', slug: 'sabre', name: 'Sabre', active: true },
  ],
  [`${RECAP}?locale=en`]: null,
  [`${RECAP}?locale=fr`]: null,
};

const recap = (status: 'draft' | 'published') => ({
  content: 'Anna won the final.',
  status,
  generatedAt: '2025-06-01T10:00:00.000Z',
  model: null,
});

/** The three saves of the Recap tab, which the server takes on an archived Event. */
export const RECAP_TAKEN: Record<string, unknown> = {
  [`POST ${RECAP}/generate?locale=en`]: recap('draft'),
  [`POST ${RECAP}/publish?locale=en`]: recap('published'),
  [`POST ${RECAP}/unpublish?locale=en`]: recap('draft'),
};

/** The button that reads `label`: the first one, from the top of the page. */
export function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(found, `no "${label}" button`).toBeDefined();
  return found!;
}

/** Closed by its own attribute, or by a `fieldset` around it that is closed. */
export const isClosed = (control: Element | null) => control?.matches(':disabled') ?? false;

/** The page's one file picker. */
export const filePicker = () => document.body.querySelector('input[type="file"]');

/**
 * Taps each named button, and says yes to the dialog it opens. A closed button
 * does not hear the tap. The kit's own sweep leaves a wizard step by its Back
 * button before it reaches the buttons above it, so those are tapped by name.
 */
export async function press(page: OpenedPage, labels: string[]): Promise<void> {
  for (const label of labels) {
    await act(async () => button(label).click());
    await page.settle();
    const yes = [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    await act(async () => yes.pop()?.click());
    await page.settle();
  }
}
