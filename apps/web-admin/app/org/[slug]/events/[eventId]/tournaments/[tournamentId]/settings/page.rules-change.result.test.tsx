import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { type } from '../../../archived-page.fixtures';
import { control } from './page.rules.fixtures';
import {
  audited,
  CAP_CHANGE,
  confirmWith,
  dialog,
  dialogButton,
  expectedOf,
  needsAudit,
  openRules,
  pressButton,
  refusedWith,
  STARTED_ROW,
  type OpenedRules,
} from './page.rules-change.fixtures';

/**
 * What the rules-change dialog says after the audited save (the audited settings change, commit
 * 5c; rulings 144, 165-167, revisions 17-18, Pass 6 items 2-3). With something to report it stays
 * open on a result view, problems first; a row the save could not read back is read again, and
 * when that read fails too the page says to reload and keeps the rules it knew.
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

type Answer = Awaited<ReturnType<typeof ApiClient.apiRequest>>;

let opened: OpenedRules;
afterEach(() => opened.page.unmount());

const AFTER = { ...STARTED_ROW, ruleset_config: { matchFormat: { pointCap: 9 } } };
const save = () => pressButton(opened, 'Save changes');
const pageText = () => document.body.textContent ?? '';

/** Opens Match format, changes the cap, and confirms the dialog the save opens. */
async function auditedCap(answer: ReturnType<typeof audited>) {
  opened = await openRules('match-format');
  opened.patches.push(needsAudit([CAP_CHANGE]), answer);
  await act(async () => type(control('Point cap'), '9'));
  await save();
  await confirmWith(opened);
}

describe('the result view after the audited save', () => {
  it('names who was not updated, an unnamed one in words, and never an id (ruling 144)', async () => {
    await auditedCap(
      audited(AFTER, {
        notSettled: [
          { registrationId: 'reg-901', name: 'Paul Martin' },
          { registrationId: 'reg-902', name: null },
        ],
      }),
    );
    const text = dialog()!.textContent!;
    expect(text).toContain('Rules saved.');
    expect(text).toContain('These Fighters were not updated:');
    expect(text).toContain('Paul Martin');
    expect(text).toContain('an entry that could not be named');
    expect(pageText()).not.toMatch(/reg-90/);
  });

  it('lists problems first, then who was brought back in step (ruling 166)', async () => {
    await auditedCap(
      audited(AFTER, {
        notSettled: [{ registrationId: 'reg-901', name: 'Paul Martin' }],
        inStep: [{ registrationId: 'reg-903', name: 'Ann Lee' }],
        handOffFailed: true,
        followFailed: true,
      }),
    );
    const text = dialog()!.textContent!;
    const at = (words: string) => {
      expect(text).toContain(words);
      return text.indexOf(words);
    };
    const order = [
      at('These Fighters were not updated:'),
      at('A Pool this change finished may not have moved on to its next phase.'),
      at('The update of the Fighters did not finish: some may not be updated.'),
      at('Brought back in step:'),
      at('Ann Lee'),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('stays open until Close, then the tab is clean (ruling 165)', async () => {
    await auditedCap(audited(AFTER, { inStep: [{ registrationId: 'reg-903', name: 'Ann Lee' }] }));
    expect(dialog()).not.toBeNull();
    await act(async () => dialogButton('Close').click());
    expect(dialog()).toBeNull();
    await save();
    expect(opened.saves).toHaveLength(2);
  });
});

describe('a save that could not read its row back', () => {
  it('reads the Tournament again: the next audit sends back what that read answered', async () => {
    const read = { ...STARTED_ROW, ruleset_config: { matchFormat: { pointCap: 9, x: 1 } } };
    opened = await openRules('match-format');
    opened.gets.push({ ok: true, data: read } as never);
    opened.patches.push(needsAudit([CAP_CHANGE]), audited(null), needsAudit([CAP_CHANGE]));
    await act(async () => type(control('Point cap'), '9'));
    await save();
    await confirmWith(opened);
    await act(async () => type(control('Point cap'), '11'));
    await save();
    await confirmWith(opened);

    expect(opened.saves[3]!.body['audit']).toMatchObject({ expected: expectedOf(read) });
  });

  it('a plain save answered while that read was out wins over it', async () => {
    let answerRead!: (answer: Answer) => void;
    const plain = { ...STARTED_ROW, scoring_config_json: { afterblowMode: 'deductive' } };
    opened = await openRules('match-format');
    opened.gets.push(new Promise<Answer>((resolve) => (answerRead = resolve)));
    opened.patches.push(
      needsAudit([CAP_CHANGE]),
      audited(null),
      { ok: true, data: plain } as Answer,
      needsAudit([CAP_CHANGE]),
    );
    await act(async () => type(control('Point cap'), '9'));
    await save();
    await confirmWith(opened);
    await act(async () => type(control('Pool match time'), '120'));
    await save();
    await act(async () => answerRead({ ok: true, data: AFTER } as Answer));
    await opened.page.settle();
    await act(async () => type(control('Point cap'), '11'));
    await save();
    await confirmWith(opened);

    expect(opened.saves, 'the dialog sent no audit').toHaveLength(5);
    expect(opened.saves[4]!.body['audit']).toMatchObject({ expected: expectedOf(plain) });
  });

  it('and when that read fails: says reload, is clean, and keeps the rules it knew (ruling 167)', async () => {
    opened = await openRules('match-format');
    opened.gets.push(refusedWith(503, null));
    opened.patches.push(needsAudit([CAP_CHANGE]), audited(null));
    await act(async () => type(control('Point cap'), '9'));
    await save();
    await confirmWith(opened);
    expect(pageText()).toContain('Rules saved. Reload the page to see them.');
    // One message, not "Rules saved." beside it.
    expect(pageText().split('Rules saved.')).toHaveLength(2);

    await save();
    expect(opened.saves).toHaveLength(2);
    opened.patches.push(needsAudit([CAP_CHANGE]));
    await act(async () => type(control('Point cap'), '11'));
    await save();
    await confirmWith(opened);
    expect(opened.saves[3]!.body['audit']).toMatchObject({ expected: expectedOf(STARTED_ROW) });
  });
});
