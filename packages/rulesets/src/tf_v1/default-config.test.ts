/**
 * With no config, TF_v1 scores, ends and ranks with its default config.
 *
 * Each of the three entry points parses `config ?? TFv1DefaultConfig`. Without
 * the fallback the parse throws on `undefined`.
 */
import { describe, expect, it } from 'vitest';
import { TF_v1 } from './index';
import { TFv1DefaultConfig } from './config';
import type { Exchange, Match, ScoredMatch } from '../types';

const MATCH: Match = {
  id: 'm1',
  redRegistrationId: 'reg-red',
  blueRegistrationId: 'reg-blue',
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  status: 'running',
};

const hit = (sequence: number, striker: 'red' | 'blue'): Exchange => ({
  id: `ex-${sequence}`,
  clientUuid: `uuid-${sequence}`,
  matchId: 'm1',
  sequence,
  type: 'clean',
  occurredAt: '2026-06-01T09:00:00.000Z',
  firstStrikerColor: striker,
  firstStrikeValue: 1,
  afterblowValue: null,
  noExchangeReason: null,
  voided: false,
});

const EXCHANGES = [hit(1, 'red'), hit(2, 'red'), hit(3, 'blue')];

describe('TF_v1 with no config', () => {
  it('scores a match with the default config', () => {
    expect(TF_v1.computeMatchScore(MATCH, EXCHANGES, 'full', undefined)).toEqual(
      TF_v1.computeMatchScore(MATCH, EXCHANGES, 'full', TFv1DefaultConfig),
    );
  });

  it('ends a match on the default point cap', () => {
    // Ten clean hits reach the default cap, so the config decides the answer:
    // a fallback to a config with another cap would not end this match.
    const tenHits = Array.from({ length: 10 }, (_, index) => hit(index + 1, 'red'));
    const score = TF_v1.computeMatchScore(MATCH, tenHits, 'full', TFv1DefaultConfig);

    const over = TF_v1.isMatchOver(MATCH, score, undefined);

    expect(over).toEqual(TF_v1.isMatchOver(MATCH, score, TFv1DefaultConfig));
    expect(over).toMatchObject({ isOver: true });
  });

  it('scores a pool with the default config', () => {
    const bout: ScoredMatch = {
      id: 'm1',
      redRegistrationId: 'reg-red',
      blueRegistrationId: 'reg-blue',
      winnerRegistrationId: 'reg-red',
      endReason: null,
      redScore: 2,
      blueScore: 1,
      exchanges: EXCHANGES,
    };
    const pool = {
      registrationIds: ['reg-red', 'reg-blue'],
      completedMatches: [bout],
      afterblowMode: 'full' as const,
    };

    expect(TF_v1.scorePoolFighters({ ...pool, config: undefined })).toEqual(
      TF_v1.scorePoolFighters({ ...pool, config: TFv1DefaultConfig }),
    );
  });
});
