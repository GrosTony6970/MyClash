import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import { isRefusal } from './mcp-answer';
import type { PreviewRefereeAnswer } from './preview-referee-assignment';
import {
  caller,
  CREW_SELECT,
  crewRow,
  DECLARANT,
  EVENT,
  JEAN,
  judgeVerdict,
  key,
  LICE,
  listEventReferees,
  MARIE,
  MATCH,
  PAUL,
  PHASE,
  POOL,
  preview,
  readOf,
  resetWorld,
  TABLE,
  TOURNAMENT,
  world,
  assertOrgRole,
  ORG,
  id,
} from './preview-referee-assignment.test-helper';
import { MATCH_SELECT } from './referee-write-gate';
import { openConfirmation } from './write-confirmation';

const NEXT =
  'Show the person this change, the crew after it and every warning; call ' +
  'apply_referee_assignment only after they say yes.';

async function answered(over: Parameters<typeof preview>[0] = {}): Promise<PreviewRefereeAnswer> {
  const result = await preview(over);
  expectNoRawIds(result);
  if (isRefusal(result)) throw new Error(`refused: ${result.refusal}`);
  return result;
}

const payloadOf = (token: string) => openConfirmation(key, token, caller, Date.now());

const theMatch = {
  code: 'LSW-P2-M04',
  tournament: 'Longsword Open',
  start: '2026-03-14T10:00:00Z',
  timezone: 'Europe/Paris',
  piste: 'Piste A',
  red: 'Anna Roux',
  blue: 'Bob Petit',
};

beforeEach(resetWorld);

describe('preview_referee_assignment answers', () => {
  it('previews a Fine swap of a Match holder, with a token that names who and the holder', async () => {
    world.crew = [crewRow(JEAN, DECLARANT, 'match')];
    const answer = await answered();
    expect(answer).toEqual({
      match: theMatch,
      role: 'Déclarant',
      from: 'Jean Dupont',
      to: 'Paul Martin',
      crewBefore: [{ role: 'Déclarant', name: 'Jean Dupont' }],
      crewAfter: [{ role: 'Déclarant', name: 'Paul Martin' }],
      level: 'fine',
      warnings: [],
      confirmation: expect.any(String),
      expiresAt: expect.any(String),
      next: NEXT,
    });
    expect(payloadOf(answer.confirmation)).toMatchObject({
      sub: caller.userId,
      cid: caller.clientId,
      matchId: MATCH,
      role: DECLARANT,
      personId: PAUL,
      prev: JEAN,
      codes: [],
    });
    expect(judgeVerdict).toHaveBeenCalledWith(EVENT, {
      matchIds: [MATCH],
      role: DECLARANT,
      personId: PAUL,
      confirm: false,
    });
  });

  it('reads each new thing with its asserted projection and filters', async () => {
    await answered();
    const tournament = readOf('tournaments', 'name, phases(id)');
    expect(tournament.args['eq']).toEqual([['id', TOURNAMENT]]);
    expect(MATCH_SELECT).toBe(
      'id, match_number_label, scheduled_at, pool_id, lice_id, lices(name), ' +
        'phases(config_json,tournaments(weapon)),pools(sort_order),bracket_slots(round),swiss_rounds(round_number)',
    );
    const matches = readOf('matches', MATCH_SELECT);
    expect(matches.args['in']).toEqual([['phase_id', [PHASE]]]);
    expect(matches.args['limit']).toEqual([[10_000]]);
    const skills = readOf('referee_skills', 'id, name, event_id');
    expect(skills.args['or']).toEqual([[`event_id.is.null,event_id.eq.${EVENT}`]]);
    const crew = readOf('referee_assignments', CREW_SELECT);
    expect(crew.args['eq']).toEqual([['event_id', EVENT]]);
    expect(crew.args['in']).toEqual([['status', ['assigned', 'confirmed', 'pending']]]);
    expect(crew.args['or']).toEqual([
      [`match_id.eq.${MATCH},pool_id.eq.${POOL},lice_id.eq.${LICE}`],
    ]);
    const fighters = readOf('vw_tournament_query_matches', 'red_name, blue_name');
    expect(fighters.args['eq']).toEqual([['match_id', MATCH]]);
    expect(listEventReferees).toHaveBeenCalledWith(EVENT, caller.userId);
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, caller.userId, 'editor');
  });

  it('scopes the crew read to the Match alone when it has no Pool and no Lice', async () => {
    world.bouts = [
      // A bracket bout: no Pool, no piste yet.
      { ...world.bouts[0]!, pool_id: null, lice_id: null, lices: null, pools: null },
    ];
    await answered({ match: 'LSW-M04' });
    expect(readOf('referee_assignments', CREW_SELECT).args['or']).toEqual([
      [`match_id.eq.${MATCH}`],
    ]);
  });

  it('previews a Discouraged swap with every warning, and seals the codes it showed', async () => {
    judgeVerdict.mockResolvedValue({
      verdict: {
        level: 'discouraged',
        reasons: [
          {
            code: 'rest',
            level: 'discouraged',
            against: { kind: 'match', id: id(40), label: 'LSW-P1-M02' },
            confirmed: false,
          },
          {
            code: 'own_pool_span',
            level: 'discouraged',
            against: { kind: 'pool', id: id(41), label: 'Pool 3' },
            confirmed: false,
          },
        ],
      },
      matchIds: [MATCH],
      skippedMatchIds: [],
    });
    const answer = await answered();
    expect(answer.level).toBe('discouraged');
    expect(answer.warnings).toEqual([
      'Paul Martin no rest since another duty (LSW-P1-M02).',
      'Paul Martin fights in a Pool, Swiss phase or bracket running at the same time (Pool 3).',
    ]);
    expect(answer.from).toBeNull();
    expect(payloadOf(answer.confirmation)).toMatchObject({
      personId: PAUL,
      prev: null,
      codes: ['own_pool_span', 'rest'],
    });
  });

  it('previews a removal unjudged, and shows the Pool crew that comes back', async () => {
    world.crew = [crewRow(JEAN, DECLARANT, 'match'), crewRow(MARIE, TABLE, 'pool')];
    const answer = await answered({ referee: null });
    expect(answer).toMatchObject({
      role: 'Déclarant',
      from: 'Jean Dupont',
      to: null,
      crewBefore: [{ role: 'Déclarant', name: 'Jean Dupont' }],
      crewAfter: [{ role: 'Table', name: 'Marie Curie' }],
      level: 'fine',
      warnings: [],
    });
    expect(payloadOf(answer.confirmation)).toMatchObject({ personId: null, prev: JEAN, codes: [] });
    expect(judgeVerdict).not.toHaveBeenCalled();
    expect(listEventReferees).not.toHaveBeenCalled();
  });

  it('shows the crew after a swap over a Pool-crew holder: the Match row hides the rest', async () => {
    world.crew = [crewRow(JEAN, DECLARANT, 'pool'), crewRow(MARIE, TABLE, 'pool')];
    const answer = await answered();
    expect(answer).toMatchObject({
      from: 'Jean Dupont',
      to: 'Paul Martin',
      crewBefore: [
        { role: 'Déclarant', name: 'Jean Dupont' },
        { role: 'Table', name: 'Marie Curie' },
      ],
      crewAfter: [{ role: 'Déclarant', name: 'Paul Martin' }],
    });
    expect(payloadOf(answer.confirmation)).toMatchObject({ prev: JEAN });
  });

  it('finds the role by its id and the referee case- and accent-blind', async () => {
    const answer = await answered({ role: 'ARBITRE_DECLARANT', referee: 'jean dupônt' });
    expect(answer).toMatchObject({ role: 'Déclarant', to: 'Jean Dupont' });
  });
});
