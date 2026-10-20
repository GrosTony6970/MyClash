/**
 * A Tournament's changes of its forfeit rules (ruling 65), as the create and the save take them.
 * Keys come from the fixed domain only, the values keep the bounds of the penalty ruleset's own
 * schema, and `null` stands at a LEAF only: it is a Reset of that key. A parent sent as null would
 * read as "reset everything below", which no screen sends, so it is refused.
 *
 * Each refusal has a positive twin on the same body, so it cannot refuse for another reason.
 */
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { CreateTournamentDto, UpdateTournamentDto } from './events.dto';

const schemaOf = (dto: unknown) => (dto as { schema: ZodTypeAny }).schema;
const CREATE = { name: 'Longsword open', slug: 'longsword-open' };

const SCHEMAS = [
  [
    'create',
    (forfeitRules: unknown) => schemaOf(CreateTournamentDto).safeParse({ ...CREATE, forfeitRules }),
  ],
  ['save', (forfeitRules: unknown) => schemaOf(UpdateTournamentDto).safeParse({ forfeitRules })],
] as const;

const injury = (rule: Record<string, unknown>) => ({ reasons: { injury: rule } });

const REFUSED: Array<[string, unknown]> = [
  ['the reasons sent as null', { reasons: null }],
  ['a reason sent as null', { reasons: { injury: null } }],
  ['the whole changes sent as null', null],
  ['a loss to 0', injury({ opponentScore: 0 })],
  ['a loss to 100', injury({ opponentScore: 100 })],
  ['a loss to 1.5', injury({ opponentScore: 1.5 })],
  ['disqualify after 0', { disqualifyAfter: 0 }],
  ['disqualify after 11', { disqualifyAfter: 11 }],
  ['a 2nd black card that does "foo"', { secondBlackCard: 'foo' }],
  ['a key the rules do not hold', { disqualifyAfterBouts: 2 }],
  ['a reason the rules do not hold', { reasons: { fatigue: { fighter: 'continues' } } }],
  ['a field a reason does not hold', injury({ points: 3 })],
];

const TAKEN: Array<[string, unknown]> = [
  [
    'a loss to 1 and to 99',
    { reasons: { injury: { opponentScore: 1 }, voluntary: { opponentScore: 99 } } },
  ],
  ['disqualify after 1', { disqualifyAfter: 1 }],
  ['disqualify after 10', { disqualifyAfter: 10 }],
  ['disqualify after Off', { disqualifyAfter: 'off' }],
  ['a 2nd black card that ends the bout', { secondBlackCard: 'match' }],
  ['a Reset of one reason field', injury({ fighter: null })],
  [
    'a Reset of every key',
    { disqualifyAfter: null, firstBlackCard: null, blackCardOpponentScore: null },
  ],
  ['no change at all', {}],
];

describe.each(SCHEMAS)('the forfeit changes of a Tournament, on its %s', (_door, parse) => {
  it.each(REFUSED)('refuse %s', (_label, forfeitRules) => {
    expect(parse(forfeitRules).success).toBe(false);
  });

  it.each(TAKEN)('take %s', (_label, forfeitRules) => {
    expect(parse(forfeitRules).error?.issues).toBeUndefined();
  });

  it('take the body without any forfeit change', () => {
    expect(parse(undefined).success).toBe(true);
  });
});
