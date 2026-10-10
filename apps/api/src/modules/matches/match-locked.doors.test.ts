/**
 * A locked bout is refused with a code of its own.
 *
 * Léa's tablet sends a hit for a bout the organiser locked a minute ago. The API refused it with a
 * plain 400: code `BAD_REQUEST`, and an English sentence the pad could only repeat. Seven doors in
 * four services wrote that refusal by hand. They throw ONE refusal now, `matchLocked()`, and the
 * pad knows it by its code.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiExceptionFilter, type ApiErrorResponse } from '../../common/api-exception.filter';
import { apiSourceFiles } from '../../common/testing/supabase-query-scan';
import { MATCH_LOCKED, matchLocked } from './match-locked';

/** What a browser receives for an exception a door threw. */
function answerOf(exception: unknown): ApiErrorResponse {
  let sent: ApiErrorResponse | undefined;
  const reply = {
    status: () => reply,
    header: () => reply,
    send: (body: ApiErrorResponse) => {
      sent = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/api/v1/matches/m1/exchanges', headers: {} }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(exception, host);
  if (!sent) throw new Error('the filter sent no answer');
  return sent;
}

describe('the refusal of a locked bout', () => {
  it('answers a 400 with its own code and the words it always had', () => {
    const answer = answerOf(matchLocked());

    expect(answer.status).toBe(400);
    expect(answer.code).toBe('match_locked');
    expect(MATCH_LOCKED).toBe('match_locked');
    expect(answer.message).toBe('Match is locked');
    expect(answer.detail).toBe('Match is locked');
    expect(answer.details).toBeUndefined();
  });

  /** The doors that refuse a locked bout, and how many times each file throws. */
  const DOORS: Record<string, number> = {
    'modules/matches/clock.service.ts': 3,
    'modules/matches/late-press.ts': 1,
    'modules/matches/match-forfeits.service.ts': 2,
    'modules/matches/matches.service.ts': 1,
    'modules/penalties/penalties.service.ts': 1,
  };

  const SRC = path.join(__dirname, '..', '..');
  const sources = apiSourceFiles(SRC).map((file) => ({
    name: path.relative(SRC, file).split(path.sep).join('/'),
    text: readFileSync(file, 'utf8'),
  }));

  it('is thrown by every door that refuses a locked bout', () => {
    const throwers = Object.fromEntries(
      sources
        .map(({ name, text }) => [name, text.split('throw matchLocked();').length - 1] as const)
        .filter(([, count]) => count > 0),
    );

    expect(throwers).toEqual(DOORS);
  });

  it('has its words in one file only', () => {
    const writers = sources
      .filter(({ text }) => /['"`]Match is locked['"`]/.test(text))
      .map(({ name }) => name);

    expect(writers).toEqual(['modules/matches/match-locked.ts']);
  });
});
