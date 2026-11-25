/**
 * A protest in a team Match names its team (ADR-022): exactly one of a Registration or a team,
 * judged by side key and kind against the bout, and stored in the column of its kind.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { writesTo } from '../../common/testing/supabase-chain';
import { PAD, RED, TEAM_BLUE, TEAM_OTHER, TEAM_RED, dto, setup } from './protests.fixtures';

describe('ProtestsService.createProtest in a team Match', () => {
  it('a team protest is stored on its team, with no Registration', async () => {
    const { db, service } = setup();

    await service.createProtest(
      'm-team',
      dto({ registrationId: undefined, teamId: TEAM_BLUE }),
      PAD,
    );
    expect(writesTo(db, 'match_protests')[0]?.row).toMatchObject({
      match_id: 'm-team',
      registration_id: null,
      team_id: TEAM_BLUE,
    });
  });

  it('a team of another bout, or a team id sent as a Registration, is refused 400', async () => {
    const { db, service } = setup();

    await expect(
      service.createProtest('m-team', dto({ registrationId: undefined, teamId: TEAM_OTHER }), PAD),
    ).rejects.toBeInstanceOf(BadRequestException);
    // A side key of this bout, sent as the wrong kind.
    await expect(
      service.createProtest('m-team', dto({ registrationId: TEAM_RED }), PAD),
    ).rejects.toBeInstanceOf(BadRequestException);
    // A Registration of the bout, sent as a team.
    await expect(
      service.createProtest('m1', dto({ registrationId: undefined, teamId: RED }), PAD),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.writes).toEqual([]);
  });

  it('a protest that names no side, or two, is refused in the words of a protest', async () => {
    const { db, service } = setup();

    await expect(
      service.createProtest('m-team', dto({ registrationId: undefined }), PAD),
    ).rejects.toThrow('A protest names exactly one side');
    await expect(
      service.createProtest('m-team', dto({ registrationId: RED, teamId: TEAM_RED }), PAD),
    ).rejects.toThrow('A protest names exactly one side');
    expect(db.writes).toEqual([]);
  });

  it('a team that is not placed on the bout yet cannot protest: its side is null', async () => {
    const { db, service } = setup();

    await expect(
      service.createProtest(
        'm-team-wait',
        dto({ registrationId: undefined, teamId: TEAM_OTHER }),
        PAD,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    // The placed side still protests: the sides are not judged as a pair.
    await service.createProtest(
      'm-team-wait',
      dto({ registrationId: undefined, teamId: TEAM_RED }),
      PAD,
    );
    expect(writesTo(db, 'match_protests')).toHaveLength(1);
  });
});
