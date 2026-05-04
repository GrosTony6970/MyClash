import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('event page — 0 critical axe violations', async ({ page }) => {
  await page.goto('http://localhost:3001/e/test-event');
  await page.waitForSelector('main');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .disableRules(['color-contrast'])
    .analyze();
  const critical = results.violations.filter((v) => v.impact === 'critical');
  expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
});
