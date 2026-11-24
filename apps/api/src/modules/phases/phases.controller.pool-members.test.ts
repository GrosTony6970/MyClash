/**
 * The body of "add to a Pool" names exactly one entrant: a Registration (individual Tournament)
 * or a team (team Tournament). The controller hands each to its service door; which kind a Pool
 * takes is the service's (`phases.team-pools.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddPoolMemberDto } from './dto/phases.dto';
import { PhasesController } from './phases.controller';

const POOL = '66666666-6666-4666-8666-666666666666';
const REG = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';
const ADMIN = 'a0000000-0000-4000-8000-000000000001';

const phases = {
  addPoolMember: vi.fn(() => Promise.resolve({ moved: true })),
  addPoolTeam: vi.fn(() => Promise.resolve({ moved: true })),
  removePoolMember: vi.fn(() => Promise.resolve({})),
};
const supabase = { getAuthUser: vi.fn(() => Promise.resolve({ id: ADMIN })) };
const req = { headers: { authorization: 'Bearer token' } };
const controller = new PhasesController(phases as never, supabase as never, {} as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AddPoolMemberDto', () => {
  const parse = (body: unknown) => AddPoolMemberDto.schema.safeParse(body).success;

  it('takes a Registration or a team, and refuses both, neither, or another field', () => {
    expect(parse({ registrationId: REG })).toBe(true);
    expect(parse({ teamId: TEAM })).toBe(true);
    expect(parse({ registrationId: REG, teamId: TEAM })).toBe(false);
    expect(parse({})).toBe(false);
    expect(parse({ teamId: 'not-a-uuid' })).toBe(false);
    expect(parse({ teamId: TEAM, seed: 1 })).toBe(false);
  });
});

describe('POST pools/:poolId/members', () => {
  it('seats a team through the team door', async () => {
    await controller.addPoolMember(POOL, { teamId: TEAM } as never, req as never);

    expect(phases.addPoolTeam.mock.calls).toEqual([[POOL, TEAM, ADMIN]]);
    expect(phases.addPoolMember).not.toHaveBeenCalled();
  });

  it('seats a Registration through the Registration door', async () => {
    await controller.addPoolMember(POOL, { registrationId: REG } as never, req as never);

    expect(phases.addPoolMember.mock.calls).toEqual([[POOL, REG, ADMIN]]);
    expect(phases.addPoolTeam).not.toHaveBeenCalled();
  });
});

describe('DELETE pools/:poolId/members/:entrantId', () => {
  it('hands the side key to the service, which reads it by the kind', async () => {
    await controller.removePoolMember(POOL, TEAM, req as never);

    expect(phases.removePoolMember.mock.calls).toEqual([[POOL, TEAM, ADMIN]]);
  });
});
