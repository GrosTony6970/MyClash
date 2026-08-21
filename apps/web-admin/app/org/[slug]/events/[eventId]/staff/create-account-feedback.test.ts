import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';

import { createAccountProblem } from './create-account-feedback';

/**
 * `t` echoing its key is what makes the assertions readable: the question here
 * is always WHICH sentence was chosen, never how it is worded.
 */
const t = (key: string) => key;

const http = (over: Partial<Extract<ApiFailure, { kind: 'http' }>> = {}): ApiFailure => ({
  kind: 'http',
  status: 409,
  detail: null,
  code: null,
  details: null,
  validationErrors: null,
  ...over,
});

describe('createAccountProblem', () => {
  it('names the collision instead of the generic refusal', () => {
    // The bug this closes: every refusal rendered `createError`, so an
    // organiser who reused a username was told nothing and retried the same one.
    const message = createAccountProblem(
      http({ code: 'staff_username_taken', details: { existingStatus: 'active' } }),
      t,
    );

    expect(message).toBe('organizer.staff.usernameTaken');
    expect(message).not.toBe('organizer.staff.createError');
  });

  it('tells the organiser to re-enable when a disabled account holds the name', () => {
    // The unique index is not partial, so the holder can be a row the active
    // roster never shows. "Taken" alone would send them inventing a second
    // name for the same volunteer.
    const message = createAccountProblem(
      http({ code: 'staff_username_taken', details: { existingStatus: 'disabled' } }),
      t,
    );

    expect(message).toBe('organizer.staff.usernameTakenDisabled');
  });

  it('falls back to taken when the API could not read the holder', () => {
    const message = createAccountProblem(http({ code: 'staff_username_taken', details: null }), t);

    expect(message).toBe('organizer.staff.usernameTaken');
  });

  it("prefers the API's own reason over anything written here", () => {
    // A 400 the API explained beats a guess from the browser — that is the
    // whole argument for reading the body at all.
    const message = createAccountProblem(
      http({ status: 400, detail: 'Validation failed', code: 'BAD_REQUEST' }),
      t,
    );

    expect(message).toBe('Validation failed');
  });

  it('keeps the old sentence as the last resort, not the only answer', () => {
    const message = createAccountProblem(http({ status: 500, detail: null }), t);

    expect(message).toBe('organizer.staff.createError');
  });

  it('says nothing when the caller aborted', () => {
    expect(createAccountProblem({ kind: 'aborted' }, t)).toBeNull();
  });
});
