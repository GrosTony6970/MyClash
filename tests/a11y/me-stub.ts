import type { Page } from '@playwright/test';
import { stubPublicApi } from './helpers';

/**
 * Léa, signed in, in her personal space (`/me/...`), with no API behind it.
 *
 * The shell reads `/me` (claimed), the Events of the sidebar and the unread count of the inbox;
 * every other call gets the catch-all `{}` of `stubPublicApi`. Register a story's own routes AFTER
 * this call: Playwright tries the last registered route first.
 */

export const PUBLIC = 'http://localhost:3001';
export const LEA = { id: 'user-1', email: 'lea@example.test', display_name: 'Léa Martin' };

export async function signInAsLea(page: Page): Promise<void> {
  await stubPublicApi(page);
  await page.route('**/api/v1/me', (route) =>
    route.fulfill({ json: { type: 'claimed', user: LEA } }),
  );
  await page.route('**/api/v1/me/events', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/notifications/broadcasts', (route) => route.fulfill({ json: [] }));
}
