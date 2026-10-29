import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import type { RulesChange } from '@myclash/types';
import { type } from '../../../archived-page.fixtures';
import { control } from './page.rules.fixtures';
import {
  audited,
  CAP_CHANGE,
  confirmWith,
  dialog,
  dialogButton,
  expectedOf,
  fillConfirm,
  needsAudit,
  openRules,
  pressButton,
  refusedWith,
  STARTED_ROW,
  type OpenedRules,
} from './page.rules-change.fixtures';

/**
 * The rules-change dialog on the Match format, Display and Advanced tabs (the audited settings
 * change, commit 5c; revision 13 §6, rulings 162, 165, 169). A locked change is not saved: the
 * coded 403 opens the dialog, which lists every change of the save, the locked ones tagged, and
 * resends the same body with the reason, the typed name and the rules the tab last knew.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', tournamentId: 't-1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/tournaments/t-1/settings',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

let opened: OpenedRules;
afterEach(() => opened.page.unmount());

/** Each tab, the field its save changes, and two values for it. */
const TABS: Array<[tab: string, field: string, first: string, second: string]> = [
  ['match-format', 'Point cap', '9', '11'],
  ['display', 'Fighter 1', 'green', 'blue'],
  ['advanced', 'Win bonus', '6', '7'],
];

async function edit(field: string, value: string) {
  await act(async () => type(control(field), value));
}
const save = () => pressButton(opened, 'Save changes');
const pageText = () => document.body.textContent ?? '';
const FINALS_TIME: RulesChange = {
  path: 'matchFormat.timeLimitsSeconds.finals',
  before: 180,
  after: 240,
  locked: false,
};

describe('a locked change on the Match format tab', () => {
  it('opens the dialog: every change listed, the locked one tagged, no Fighters section', async () => {
    opened = await openRules('match-format');
    opened.patches.push(needsAudit([CAP_CHANGE, FINALS_TIME]));
    await edit('Point cap', '9');
    await save();

    const items = [...(dialog()?.querySelectorAll('li') ?? [])].map((li) => li.textContent);
    expect(items).toEqual(['Point cap: 5 → 7locked', 'Bout time (finals): 180 s → 240 s']);
    expect(dialog()!.textContent).not.toContain('status changes');
    expect(dialog()!.textContent).not.toContain('change status at once');
    expect(pageText()).not.toContain('An English sentence.');
  });

  it('keeps the confirm closed until a 10-character reason and the stored name', async () => {
    opened = await openRules('match-format');
    opened.patches.push(needsAudit([CAP_CHANGE]));
    await edit('Point cap', '9');
    await save();

    const confirm = () => dialogButton('Save the change');
    await fillConfirm('Too short', 'Longsword');
    expect(confirm().disabled).toBe(true);
    await fillConfirm('The federation changed the cap.', 'Longswor');
    expect(confirm().disabled).toBe(true);
    await fillConfirm('The federation changed the cap.', '  longsword ');
    expect(confirm().disabled).toBe(false);
  });

  it('resends the same body with the audit, closes, says saved, and leaves the tab clean', async () => {
    opened = await openRules('match-format');
    const after = { ...STARTED_ROW, ruleset_config: { matchFormat: { pointCap: 9 } } };
    opened.patches.push(needsAudit([CAP_CHANGE]), audited(after));
    await edit('Point cap', '9');
    await save();
    await confirmWith(opened);

    const [first, resend] = opened.saves;
    expect(resend!.body).toEqual({
      ...first!.body,
      audit: {
        justification: 'The federation changed the cap.',
        confirm: 'Longsword',
        expected: expectedOf(STARTED_ROW),
      },
    });
    expect(dialog()).toBeNull();
    expect(pageText()).toContain('Rules saved.');
    // Clean: the next Save has nothing to send.
    await save();
    expect(opened.saves).toHaveLength(2);
    expect(pageText()).toContain('No changes to save');
  });
});

describe.each(TABS)('the %s tab', (tab, field, first, second) => {
  it('sends back the rules its last audited save answered', async () => {
    opened = await openRules(tab);
    const after = { ...STARTED_ROW, ruleset_config: { matchFormat: { pointCap: 9 } } };
    opened.patches.push(needsAudit([CAP_CHANGE]), audited(after), needsAudit([CAP_CHANGE]));
    await edit(field, first);
    await save();
    await confirmWith(opened);
    await edit(field, second);
    await save();
    await confirmWith(opened);

    expect(opened.saves[3]!.body['audit']).toMatchObject({ expected: expectedOf(after) });
  });

  it('sends back the rules its last plain save answered', async () => {
    opened = await openRules(tab);
    const allowed = { ...STARTED_ROW, scoring_config_json: { afterblowMode: 'deductive' } };
    opened.patches.push({ ok: true, data: allowed }, needsAudit([CAP_CHANGE]));
    await edit(field, first);
    await save();
    await edit(field, second);
    await save();
    await confirmWith(opened);

    expect(opened.saves[2]!.body['audit']).toMatchObject({ expected: expectedOf(allowed) });
  });

  it('opens on the coded refusal only: an uncoded 403 is said, and opens nothing', async () => {
    opened = await openRules(tab);
    opened.patches.push(refusedWith(403, 'FORBIDDEN'), needsAudit([CAP_CHANGE]));
    await edit(field, first);
    await save();
    expect(dialog()).toBeNull();
    // No code to word: the API's own sentence is said.
    expect(pageText()).toContain('An English sentence.');
    await save();
    expect(dialog()).not.toBeNull();
  });
});

describe('a refusal of a rules save, in words', () => {
  it('says what closed the rules: the Event (ruling 148)', async () => {
    opened = await openRules('match-format');
    opened.patches.push(refusedWith(403, 'rules_change_closed', { closedBy: 'event' }));
    await edit('Point cap', '9');
    await save();
    expect(pageText()).toContain(
      'The event of this tournament is completed or archived: its rules can no longer change.',
    );
    expect(pageText()).not.toContain('An English sentence.');
  });

  it('keeps the dialog open with the reload words when the rules moved since', async () => {
    opened = await openRules('match-format');
    opened.patches.push(needsAudit([CAP_CHANGE]), refusedWith(409, 'rules_changed_since_read'));
    await edit('Point cap', '9');
    await save();
    await confirmWith(opened);

    expect(dialog()!.textContent).toContain(
      'The rules of this tournament changed since this page read them.',
    );
    expect(opened.saves).toHaveLength(2);
  });
});

describe('Cancel', () => {
  it('sends nothing, and the edit stays to be saved again', async () => {
    opened = await openRules('match-format');
    opened.patches.push(needsAudit([CAP_CHANGE]));
    await edit('Point cap', '9');
    await save();
    await act(async () => dialogButton('Cancel').click());

    expect(dialog()).toBeNull();
    expect(opened.saves).toHaveLength(1);
    await save();
    expect(opened.saves[1]!.body).toEqual(opened.saves[0]!.body);
  });
});
