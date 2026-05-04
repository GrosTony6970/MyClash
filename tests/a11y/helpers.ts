import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export interface PageIssue {
  type: 'pageerror' | 'console';
  message: string;
}

export function collectPageIssues(page: Page): PageIssue[] {
  const issues: PageIssue[] = [];

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', message: error.message });
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push({ type: 'console', message: message.text() });
    }
  });

  return issues;
}

export async function expectNoPageIssues(issues: PageIssue[]) {
  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
}

export async function expectNoCriticalAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const critical = results.violations.filter((violation) => violation.impact === 'critical');

  expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
}

export async function focusUntil(page: Page, target: Locator, maxTabs = 20) {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    if (
      await target.evaluate((element) => {
        const active = document.activeElement;
        return active === element || element.contains(active);
      })
    ) {
      await expect(target).toBeFocused();
      return;
    }
  }

  throw new Error(`Could not focus ${await target.evaluate((element) => element.outerHTML)}`);
}
