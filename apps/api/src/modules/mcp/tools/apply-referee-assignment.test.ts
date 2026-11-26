import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLY_MATCH_SELECT, type ApplyRefereeAnswer } from './apply-referee-assignment';
import { isRefusal } from './mcp-answer';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import {
  apply,
  assertOrgRole,
  caller,
  CREW_SELECT,
  crewRow,
  DECLARANT,
  EVENT,
  getClient,
  id,
  insert,
  JEAN,
  judgeVerdict,
  LICE,
  listEventReferees,
  MARC,
  MATCH,
  ORG,
  PAUL,
  POOL,
  readOf,
  resetWorld,
  seal,
  setRefereeRoleAssignment,
  world,
} from './preview-referee-assignment.test-helper';

async function done(token: string): Promise<ApplyRefereeAnswer> {
  const result = await apply(token);
  expectNoRawIds(result);
  if (isRefusal(result)) throw new Error(`refused: ${result.refusal}`);
  return result;
}

/** The one audit row's insert, asserted whole. */
function auditRow(over: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  return {
    actor_user_id: caller.userId,
    action: 'match.referee_role_assigned',
    entity_type: 'match',
    entity_id: MATCH,
    payload_json: {
      via: 'mcp',
      clientId: caller.clientId,
      clientName: 'Claude',
      role: DECLARANT,
      previousPersonId: JEAN,
      personId: PAUL,
      confirmedReasons: [],
      ...payload,
    },
    ...over,
  };
}

const rest = {
  code: 'rest',
  level: 'discouraged',
  against: { kind: 'match', id: id(40), label: 'LSW-P1-M02' },
  confirmed: false,
};

beforeEach(() => {
  resetWorld();
  world.crew = [crewRow(JEAN, DECLARANT, 'match')];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apply_referee_assignment writes', () => {
  it('a Fine swap once, unconfirmed, then audits it once, and answers Done', async () => {
    expect(await done(seal())).toEqual({
      result: 'Done',
      match: 'LSW-P2-M04',
      role: 'Déclarant',
      from: 'Jean Dupont',
      to: 'Paul Martin',
    });
    expect(setRefereeRoleAssignment).toHaveBeenCalledTimes(1);
    expect(setRefereeRoleAssignment).toHaveBeenCalledWith(MATCH, DECLARANT, PAUL, false);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith('audit_log', auditRow());
    expect(getClient).toHaveBeenCalledWith(caller.clientId);
    expect(judgeVerdict).toHaveBeenCalledWith(EVENT, {
      matchIds: [MATCH],
      role: DECLARANT,
      personId: PAUL,
      confirm: false,
    });
  });

  it('reads the bout by id with its Event, and the crew, roster and roles of that Event', async () => {
    await done(seal());
    expect(APPLY_MATCH_SELECT).toBe(
      'id, match_number_label, scheduled_at, pool_id, lice_id, lices(name), ' +
        'phases(config_json,tournaments(weapon,events(id,name,status))),' +
        'pools(sort_order),bracket_slots(round),swiss_rounds(round_number)',
    );
    expect(readOf('matches', APPLY_MATCH_SELECT).args['eq']).toEqual([['id', MATCH]]);
    const crew = readOf('referee_assignments', CREW_SELECT);
    expect(crew.args['eq']).toEqual([['event_id', EVENT]]);
    expect(crew.args['in']).toEqual([['status', ['assigned', 'confirmed', 'pending']]]);
    expect(crew.args['or']).toEqual([
      [`match_id.eq.${MATCH},pool_id.eq.${POOL},lice_id.eq.${LICE}`],
    ]);
    expect(readOf('referee_skills', 'id, name, event_id').args['or']).toEqual([
      [`event_id.is.null,event_id.eq.${EVENT}`],
    ]);
    expect(listEventReferees).toHaveBeenCalledWith(EVENT, caller.userId);
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, caller.userId, 'editor');
  });

  it('a Discouraged swap the person saw, confirmed, with the reasons it confirmed', async () => {
    judgeVerdict.mockResolvedValue({ verdict: { level: 'discouraged', reasons: [rest] } });
    await done(seal({ codes: ['rest'] }));
    expect(setRefereeRoleAssignment).toHaveBeenCalledWith(MATCH, DECLARANT, PAUL, true);
    expect(insert).toHaveBeenCalledWith('audit_log', auditRow({}, { confirmedReasons: ['rest'] }));
  });

  it('a removal as null, unjudged, audited as a removal, naming who takes the role back', async () => {
    world.crew = [crewRow(JEAN, DECLARANT, 'match'), crewRow(MARC, DECLARANT, 'pool')];
    expect(await done(seal({ personId: null }))).toEqual({
      result: 'Done',
      match: 'LSW-P2-M04',
      role: 'Déclarant',
      from: 'Jean Dupont',
      to: 'Marc Blanc',
    });
    expect(setRefereeRoleAssignment).toHaveBeenCalledWith(MATCH, DECLARANT, null, false);
    expect(insert).toHaveBeenCalledWith(
      'audit_log',
      auditRow({ action: 'match.referee_role_removed' }, { personId: null }),
    );
    expect(judgeVerdict).not.toHaveBeenCalled();
    expect(listEventReferees).not.toHaveBeenCalled();
  });

  it('refuses a replay of the same token: the holder is now the new person', async () => {
    const token = seal();
    await done(token);
    world.crew = [crewRow(PAUL, DECLARANT, 'match')];
    expect(await apply(token)).toEqual({
      refusal: 'The referees of LSW-P2-M04 changed since the preview. Preview the change again.',
    });
    expect(setRefereeRoleAssignment).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('audits only after the write', async () => {
    await done(seal());
    const [written] = setRefereeRoleAssignment.mock.invocationCallOrder;
    const [audited] = insert.mock.invocationCallOrder;
    expect(written).toBeLessThan(audited!);
  });
});

describe('apply_referee_assignment names the app', () => {
  it('as null when the auth server does not know the client, with a warning', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    getClient.mockResolvedValue({
      data: null,
      error: { status: 404, code: 'oauth_client_not_found', message: 'not found' },
    });
    await done(seal());
    expect(setRefereeRoleAssignment).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith('audit_log', auditRow({}, { clientName: null }));
    expect(warn).toHaveBeenCalledWith('connector app name read failed: 404 oauth_client_not_found');
  });

  it('as null when the read throws, and still writes', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    getClient.mockRejectedValue(new Error('fetch failed'));
    await done(seal());
    expect(insert).toHaveBeenCalledWith('audit_log', auditRow({}, { clientName: null }));
    expect(warn).toHaveBeenCalledWith('connector app name read threw: fetch failed');
  });

  it('as null when the answer has no client_name', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    getClient.mockResolvedValue({ data: { client_id: 'x' }, error: null });
    await done(seal());
    expect(insert).toHaveBeenCalledWith('audit_log', auditRow({}, { clientName: null }));
    expect(warn).toHaveBeenCalledWith('connector app name read answered no client_name');
  });
});

describe('apply_referee_assignment audit failure', () => {
  it('logs a failed audit insert and still answers Done', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    world.auditError = true;
    expect(await done(seal())).toMatchObject({ result: 'Done' });
    expect(error).toHaveBeenCalledWith(
      `Could not write audit log for match.referee_role_assigned on match:${MATCH}`,
    );
  });
});
