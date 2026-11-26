import { describe, expect, it } from 'vitest';
import { QUERY_ACCESS_POLICIES, TournamentQuerySettingsDto } from './tournament-query.dto';

/** Ruling 988: the "coaches" access setting is gone; three settings are left. */
describe('the query settings schema', () => {
  const schema = TournamentQuerySettingsDto.schema;

  it('lists exactly three access settings', () => {
    expect([...QUERY_ACCESS_POLICIES]).toEqual([
      'organizers_only',
      'organizers_head_judges',
      'anyone_with_tournament_access',
    ]);
  });

  it.each(QUERY_ACCESS_POLICIES)('accepts %s', (accessPolicy) => {
    expect(schema.safeParse({ accessPolicy }).success).toBe(true);
  });

  it('refuses the removed coaches setting', () => {
    expect(schema.safeParse({ accessPolicy: 'organizers_head_judges_coaches' }).success).toBe(
      false,
    );
  });
});
