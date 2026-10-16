import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { refusalMessage } from './refusal-copy';

/**
 * "Reset clock" after extra time was granted is refused (operator, 2026-10-16, "Reset + chain").
 * The server's sentence is English, so the pad says the code in the reader's language. The
 * failure is built as `apiRequest` builds it: the code is its own member (`refusal-copy.test.ts`).
 */
const t = (key: string) => key;

const refused: ApiFailure = {
  kind: 'http',
  status: 400,
  detail: 'The clock cannot be reset once extra time or sudden death is under way',
  code: 'reset_after_level_step',
  details: null,
  validationErrors: null,
};

describe('refusalMessage — a Reset after a level step', () => {
  it('says it in its own words', () => {
    expect(refusalMessage(refused, t, 'scoring.corrections.actionFailed')).toBe(
      'scoring.level.resetRefused',
    );
  });
});
