/**
 * The forfeit panel's question and body (`forfeit-body.ts`).
 *
 * Lyon Blades withdraw from their Pool Match against Paris Rapiers. The scorekeeper records the
 * forfeit on the pad: it names the team, never a Registration, and asks nothing of whether the
 * team can go on, because a team has no status (call 4). Anna, who withdraws injured from an
 * individual Pool bout, is still asked whether she can go on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forfeitBody, forfeitQuestionFor } from './forfeit-body';

const LYON = { kind: 'team', id: 'team-lyon' } as const;
const ANNA = { kind: 'registration', id: 'reg-anna' } as const;
const ASKED = { ask: true, unconfirmed: false };
const UNCONFIRMED = { ask: true, unconfirmed: true };

describe('forfeitQuestionFor', () => {
  it('asks a team nothing, and says nothing of rules it does not hold', () => {
    expect(forfeitQuestionFor(ASKED, LYON)).toEqual({ ask: false, unconfirmed: false });
    expect(forfeitQuestionFor(UNCONFIRMED, LYON)).toEqual({ ask: false, unconfirmed: false });
  });

  it('asks a Fighter what the rules ask', () => {
    expect(forfeitQuestionFor(ASKED, ANNA)).toEqual(ASKED);
    expect(forfeitQuestionFor(UNCONFIRMED, ANNA)).toEqual(UNCONFIRMED);
  });
});

describe('forfeitBody', () => {
  it('a team’s forfeit names the team, and sends no answer about going on', () => {
    const body = forfeitBody({
      side: LYON,
      reason: 'voluntary',
      canContinue: true,
      question: ASKED,
      note: '',
    });
    expect(body).toEqual({ forfeitingTeamId: 'team-lyon', reason: 'voluntary' });
    expect(JSON.parse(JSON.stringify(body))).not.toHaveProperty('canContinue');
    expect(body).not.toHaveProperty('forfeitingRegistrationId');
  });

  it('a Fighter’s forfeit names the Registration, with the answer when asked', () => {
    expect(
      forfeitBody({ side: ANNA, reason: 'injury', canContinue: false, question: ASKED, note: ' ' }),
    ).toEqual({ forfeitingRegistrationId: 'reg-anna', reason: 'injury', canContinue: false });
  });

  it('a Fighter’s forfeit the rules do not ask about sends no answer', () => {
    const body = forfeitBody({
      side: ANNA,
      reason: 'black_card_1',
      canContinue: true,
      question: { ask: false, unconfirmed: false },
      note: 'struck after the halt',
    });
    expect(body).toEqual({
      forfeitingRegistrationId: 'reg-anna',
      reason: 'black_card_1',
      canContinue: undefined,
      note: 'struck after the halt',
    });
  });
});

describe('the panel', () => {
  // web-staff has no React test setup: the screen is read as text.
  const panel = readFileSync(join(__dirname, '..', 'components', 'ForfeitPanel.tsx'), 'utf8');

  it('sends the body of the side picked, and shows the question of that side', () => {
    expect(panel).toContain('const side = sideOf(sides, fighter);');
    expect(panel).toContain('const question = forfeitQuestionFor(rulesQuestion, side);');
    expect(panel).toContain(
      'body: forfeitBody({ side, reason, canContinue, question: rulesQuestion, note }),',
    );
    expect(panel).toContain('{question.ask && (');
  });

  // A bracket bout whose blue side is still to come: nobody to forfeit, so nothing is sent and
  // the panel says why, in the reader's language, before any request.
  it('sends nothing for a corner with no side yet, and says why', () => {
    const submit = panel.slice(panel.indexOf('async function submit()'));
    const guard = submit.indexOf(
      "if (side === null) {\n      setError(t('pad.corrections.boutSideMissing'));\n      return;\n    }",
    );
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(submit.indexOf('padRequest('));
  });
});
