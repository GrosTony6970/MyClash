import { describe, expect, it } from 'vitest';
import { saveBody, type TournamentBasics } from './basics-save';

/**
 * A team Tournament's Save sends no forfeit rules (ruling 972), so what it leaves stored is what
 * was stored before, even when the form held a change typed before the switch to team: the tab
 * must not think the server took a change it was never sent.
 */
const FORM: TournamentBasics = {
  entrantKind: 'team',
  teamDefaultSize: 3,
  name: 'Team Longsword',
  slug: 'team-longsword',
  weapon: null,
  rulesetCode: 'TF_v1',
  rulesetVersion: '1.0.0',
  penaltyRulesetId: 'pr-1',
  maxParticipants: 8,
  maxWaitlist: 4,
  forfeitRules: { reasons: { injury: { opponentScore: 41 } } },
};
const STORED = { pin: 'pr-1', forfeit: null };

describe('the Basics Save of a team Tournament', () => {
  it('sends neither the forfeit change nor the waitlist, and leaves the stored rules stored', () => {
    const { body, stored } = saveBody(FORM, STORED, 'team');
    expect(body).not.toHaveProperty('forfeitRules');
    expect(body).not.toHaveProperty('maxWaitlist');
    expect(stored).toEqual(STORED);
  });

  it('sends the kind only when it differs from the stored one', () => {
    // A stale tab still on "individual" saves a name: the team kind set elsewhere stays.
    expect(saveBody(FORM, STORED, 'team').body).not.toHaveProperty('entrantKind');
    expect(saveBody(FORM, STORED, 'individual').body).toHaveProperty('entrantKind', 'team');
    const individual = { ...FORM, entrantKind: 'individual' as const };
    expect(saveBody(individual, STORED, 'individual').body).not.toHaveProperty('entrantKind');
    expect(saveBody(individual, STORED, 'team').body).toHaveProperty('entrantKind', 'individual');
  });

  it('an individual Tournament sends the change, and stores it', () => {
    const { body, stored } = saveBody({ ...FORM, entrantKind: 'individual' }, STORED, 'individual');
    expect(body).toHaveProperty('forfeitRules', { reasons: { injury: { opponentScore: 41 } } });
    expect(stored.forfeit).toEqual({ reasons: { injury: { opponentScore: 41 } } });
  });
});
