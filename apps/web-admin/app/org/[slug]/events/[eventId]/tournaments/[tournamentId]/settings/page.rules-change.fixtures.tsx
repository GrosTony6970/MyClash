/**
 * The harness of the rules-change dialog tests (the audited settings change, commit 5c): the
 * settings page opened on a tab of a STARTED Tournament, each save answered in turn from a queue
 * the test fills (`patches`), each later read of the Tournament answered from a queue too (`gets`,
 * a promise to hold one), and every save body captured. A save with no answer queued answers 200
 * with the row: plain, or wrapped as the audited save answers it (`audited`). The test file owns
 * its `vi.mock` calls, as
 * `archived-page.fixtures.tsx` says.
 */
import { act } from 'react';
import { expect, vi } from 'vitest';
import * as ApiClient from '@myclash/api-client';
import type { RulesChange, RulesExpected } from '@myclash/types';
import { openEventPage, type, type OpenedPage } from '../../../archived-page.fixtures';
import { button, TOURNAMENT_ID, TOURNAMENT_READS, TOURNAMENT_ROW } from './page.fixtures';
import TournamentSettingsPage from './page';

type Answer = Awaited<ReturnType<typeof ApiClient.apiRequest>>;
type Row = Record<string, unknown>;

export const TOURNAMENT = `/api/v1/tournaments/${TOURNAMENT_ID}`;

/** A started Tournament: its raw rules are what `audit.expected` carries back, byte for byte. */
export const STARTED_ROW = {
  ...TOURNAMENT_ROW,
  status: 'running',
  ruleset_is_system: false,
  ruleset_config: { matchFormat: { pointCap: 5 } },
  scoring_config_json: { afterblowMode: 'full' },
  penalty_ruleset_version: '1',
  forfeit_rules: { reasons: { injury: { fighter: 'withdrawn' } } },
};

/** The rules of a row as the dialog must send them back (`storedRulesOf`). */
export const expectedOf = (row: Row): RulesExpected => ({
  rulesetCode: (row['ruleset_code'] as string) ?? null,
  rulesetVersion: (row['ruleset_version'] as string) ?? null,
  rulesetConfig: (row['ruleset_config'] as Row) ?? null,
  scoringConfig: (row['scoring_config_json'] as Row) ?? null,
  penaltyRulesetId: (row['penalty_ruleset_id'] as string) ?? null,
  penaltyRulesetVersion: (row['penalty_ruleset_version'] as string) ?? null,
  forfeitRules: (row['forfeit_rules'] as RulesExpected['forfeitRules']) ?? null,
});

/** A Fighter of the dialog, as the 403 names them. */
export const fighter = (registrationId: string, name: string, before: string, after: string) => ({
  registrationId,
  name,
  before,
  after,
});

/** The lock's refusal: the dialog opens on it. */
export const needsAudit = (
  changes: RulesChange[],
  fighters: ReturnType<typeof fighter>[] = [],
): Answer =>
  ({
    ok: false,
    kind: 'unauthenticated',
    status: 403,
    detail: 'This tournament has started: these rules need the audit.',
    code: 'rules_change_needs_audit',
    details: { changes, fighters },
  }) as Answer;

/** Any other refusal: its English sentence must never reach the screen when it carries a code. */
export const refusedWith = (status: number, code: string | null, details: Row | null = null) =>
  (status === 403
    ? { ok: false, kind: 'unauthenticated', status, detail: 'An English sentence.', code, details }
    : {
        ok: false,
        kind: 'http',
        status,
        detail: 'An English sentence.',
        validationErrors: null,
        code,
        details,
      }) as Answer;

/** The audited save's 200: the row read back (null when it was not), and what the follow did. */
export const audited = (tournament: Row | null, change: Row = {}): Answer =>
  ({
    ok: true,
    data: {
      tournament,
      rulesetChange: {
        changes: [],
        readBackFailed: tournament === null,
        notSettled: [],
        inStep: [],
        handOffFailed: false,
        followFailed: false,
        ...change,
      },
    },
  }) as Answer;

export interface OpenedRules {
  page: OpenedPage;
  /** Every save the page sent: its path and body, in order. */
  saves: Array<{ path: string; body: Row }>;
  /** The answers of the next saves, in order. */
  patches: Answer[];
  /** The answers of the next reads of the Tournament, in order (a promise holds one). */
  gets: Array<Answer | Promise<Answer>>;
}

/** Opens the settings page on `tab` (its hash key) over `row`, `reads` over the page's reads. */
export async function openRules(
  tab: string,
  row: Row = STARTED_ROW,
  reads: Record<string, unknown> = {},
): Promise<OpenedRules> {
  window.history.replaceState(null, '', `/#${tab}`);
  const page = await openEventPage(<TournamentSettingsPage />, {
    ...TOURNAMENT_READS,
    ...reads,
    [TOURNAMENT]: row,
  });
  const opened: OpenedRules = { page, saves: [], patches: [], gets: [] };
  const read = vi.mocked(ApiClient.apiRequest).getMockImplementation()!;
  vi.mocked(ApiClient.apiRequest).mockImplementation(async (base, path, init) => {
    if (!init?.method || init.method === 'GET') {
      if (path === TOURNAMENT && opened.gets.length > 0) return opened.gets.shift()!;
      return read(base, path, init);
    }
    const body = init.body as Row;
    opened.saves.push({ path, body });
    return (
      opened.patches.shift() ??
      ('audit' in body ? audited(row) : ({ ok: true, data: row } as Answer))
    );
  });
  return opened;
}

/** The open dialog, or null. */
export const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');

/** The dialog's button that reads `label`. */
export function dialogButton(label: string): HTMLButtonElement {
  const found = [...(dialog()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === label,
  );
  expect(found, `no "${label}" button in the dialog`).toBeDefined();
  return found!;
}

/** Presses a button of the page, then lets every answer land. */
export async function pressButton(opened: OpenedRules, label: string): Promise<void> {
  await act(async () => button(label).click());
  await opened.page.settle();
}

/** Types the reason and the name in the dialog. */
export async function fillConfirm(reason: string, name: string): Promise<void> {
  expect(dialog(), 'the dialog did not open').not.toBeNull();
  const box = dialog()!;
  await act(async () => type(box.querySelector('textarea')!, reason));
  await act(async () => type(box.querySelector('input')!, name));
}

/** Confirms the dialog with a good reason and the stored name. */
export async function confirmWith(opened: OpenedRules, name = 'Longsword'): Promise<void> {
  await fillConfirm('The federation changed the cap.', name);
  await act(async () => dialogButton('Save the change').click());
  await opened.page.settle();
}

/** The Point cap change of a started Tournament, as the lock lists it. */
export const CAP_CHANGE: RulesChange = {
  path: 'matchFormat.pointCap',
  before: 5,
  after: 7,
  locked: true,
};
