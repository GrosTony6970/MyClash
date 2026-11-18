import { test, expect } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { openForScoring } from './_bracket';
import { aMatch, readMatch } from './_pad';

/**
 * The organiser's forfeit rules, set on screen, then deciding a real forfeit
 * (run with `E2E_FORFEIT=1`, alongside `35`).
 *
 * `35-forfeit-cascade` proves what a forfeit does to a Pool, through the API,
 * under the rules a penalty ruleset ships with. Nothing drove the screen where
 * an organiser CHANGES those rules for one Tournament, nor the audit a change
 * needs once the Tournament has started. This spec does, on one Match:
 *
 *   1. before any bout runs, the Basics tab saves a changed injury rule — a loss
 *      at 9 for the opponent, the fighter continues — and no disqualification
 *      count, and the rules in force read them back;
 *   2. once a bout runs, the same Save is refused until the organiser gives a
 *      reason and types the Tournament's name; the change then lands, and the
 *      Tournament's public header lists it with that reason;
 *   3. an injury forfeit is then decided by the saved rule: the forfeiting
 *      fighter 0, the opponent the new score, the opponent the winner.
 *
 * The default injury rule keeps the score as it stood, so on a bout with no
 * hits a forfeit under it would read 0-0. A 0-7 can come only from the rule
 * this spec saved.
 */
const FORFEIT = ['1', 'true', 'yes'].includes((process.env.E2E_FORFEIT ?? '').toLowerCase());

/** The opponent's score on a loss, before and after the audited change. */
const FIRST_SCORE = 9;
const AUDITED_SCORE = 7;
const REASON = 'E2E: the organiser corrects the injury score';

interface ReasonRule {
  outcome: string;
  opponentScore: number;
  fighter: string;
}

interface ForfeitRulesInForce {
  inForce: { reasons: { injury: ReasonRule }; disqualifyAfter: number | 'off' };
}

test.describe('forfeit settings', () => {
  test.skip(!FORFEIT, 'set E2E_FORFEIT=1 to set forfeit rules on screen and decide a forfeit');

  test('a rule saved on the Basics tab, then changed under audit, decides the forfeit', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const api = apiFor(request);
    const { orgSlug, eventId, eventSlug, baseURL } = runContext();
    const match = await aMatch(api, 'forfeit-rules');
    const tournamentName = 'Pad forfeit-rules';
    const settingsUrl = `${baseURL}/org/${orgSlug}/events/${eventId}/tournaments/${match.tournamentId}/settings#basics`;

    // ── 1. Before any bout runs, a plain Save ─────────────────────────────
    await page.goto(settingsUrl);
    await expect(page.getByTestId('forfeit-injury-outcome')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('forfeit-injury-outcome').selectOption('fixed_loss');
    await page.getByTestId('forfeit-injury-score').fill(String(FIRST_SCORE));
    await page.getByTestId('forfeit-injury-fighter').selectOption('continues');
    await page.getByTestId('forfeit-disqualify-after').selectOption('off');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect
      .poll(async () => (await rulesInForce(api, match.tournamentId)).inForce, {
        timeout: 20_000,
        message: 'the Basics tab must store the changed injury rule',
      })
      .toMatchObject({
        reasons: {
          injury: { outcome: 'fixed_loss', opponentScore: FIRST_SCORE, fighter: 'continues' },
        },
        disqualifyAfter: 'off',
      });

    // ── 2. Once a bout runs, the change needs a reason and the name ───────
    await openForScoring(api, match.matchId);
    await page.goto(settingsUrl);
    await expect(page.getByTestId('forfeit-injury-score')).toHaveValue(String(FIRST_SCORE), {
      timeout: 30_000,
    });
    await page.getByTestId('forfeit-injury-score').fill(String(AUDITED_SCORE));
    await page.getByRole('button', { name: 'Save changes' }).click();

    const dialog = page.getByRole('dialog', { name: 'Change the rules of a started tournament?' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    // The refused Save wrote nothing.
    expect((await rulesInForce(api, match.tournamentId)).inForce.reasons.injury.opponentScore).toBe(
      FIRST_SCORE,
    );
    const confirm = dialog.getByRole('button', { name: 'Save the change' });
    await expect(confirm, 'no reason and no name: the change cannot be confirmed').toBeDisabled();
    await dialog.getByLabel('Reason for the change').fill(REASON);
    await dialog
      .getByLabel(`Type the tournament name to confirm: ${tournamentName}`)
      .fill(tournamentName);
    await confirm.click();

    await expect
      .poll(
        async () =>
          (await rulesInForce(api, match.tournamentId)).inForce.reasons.injury.opponentScore,
        { timeout: 20_000, message: 'the audited change must land' },
      )
      .toBe(AUDITED_SCORE);

    // The change is disclosed with its reason on the Tournament's header. A
    // member of the organisation reads it even while the Tournament is a draft.
    const standings = await api.json<{
      tournament: { rulesetRepins: Array<{ kind: string; justification: string }> };
    }>(await api.get(`events/${eventSlug}/tournaments/${match.tournamentSlug}/standings`));
    expect(
      standings.tournament.rulesetRepins.map((r) => ({
        kind: r.kind,
        justification: r.justification,
      })),
      'the audited change must be listed, with its reason',
    ).toContainEqual({ kind: 'settings', justification: REASON });

    // ── 3. The saved rule decides the forfeit ─────────────────────────────
    await api.ok(
      await api.post(`matches/${match.matchId}/forfeit`, {
        data: { forfeitingRegistrationId: match.redRegistrationId, reason: 'injury' },
      }),
    );
    const decided = await readMatch(api, match.matchId);
    expect({
      status: decided.status,
      red: decided.red_score,
      blue: decided.blue_score,
      winner: decided.winner_registration_id,
      endReason: decided.end_reason,
    }).toEqual({
      status: 'completed',
      red: 0,
      blue: AUDITED_SCORE,
      winner: match.blueRegistrationId,
      endReason: 'forfeit',
    });
    const record = await readForfeit(api, match.matchId);
    expect({ policy: record?.score_policy, opponent: record?.opponent_score }).toEqual({
      policy: 'fixed_loss',
      opponent: AUDITED_SCORE,
    });
  });
});

const rulesInForce = async (api: Api, tournamentId: string): Promise<ForfeitRulesInForce> =>
  api.json<ForfeitRulesInForce>(await api.get(`tournaments/${tournamentId}/forfeit-rules`));

/** The bout's forfeit record. The route answers a bare `null` when there is none. */
async function readForfeit(
  api: Api,
  matchId: string,
): Promise<{ score_policy: string; opponent_score: number } | null> {
  const res = await api.ok(await api.get(`matches/${matchId}/forfeit`));
  const text = await res.text();
  return text
    ? (JSON.parse(text) as { score_policy: string; opponent_score: number } | null)
    : null;
}
