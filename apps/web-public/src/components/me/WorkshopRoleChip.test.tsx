// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkshopRoleChip } from './WorkshopRoleChip';

vi.mock('@myclash/next-i18n/client', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
}));

/**
 * The chip's wash sits on an opaque page-coloured base. On a my-schedule clash card
 * (`bg-danger/10`) the chip's own 15% wash stacked on the card's, and "Attending" read 3.93:1
 * against the 4.5:1 its ink clears on its wash over the page (known-deviations D34).
 */
describe('WorkshopRoleChip', () => {
  it.each([
    ['attending', 'bg-success/15 text-success', 'publicApp.me.events.roleParticipant'],
    ['teaching', 'bg-instructor/15 text-instructor', 'publicApp.me.events.roleInstructor'],
  ] as const)('puts the %s wash on an opaque page-coloured base', (role, wash, word) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<WorkshopRoleChip role={role} />);
    const base = host.firstElementChild as HTMLElement;
    const chip = base.firstElementChild as HTMLElement;

    expect(base.className).toContain('bg-background');
    for (const name of wash.split(' ')) expect(chip.className).toContain(name);
    expect(chip.textContent).toBe(word);
  });
});
