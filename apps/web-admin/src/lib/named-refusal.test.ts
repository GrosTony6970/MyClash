import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';
import { createTranslator, getMessages } from '@myclash/i18n';
import { kindRefusal } from './named-refusal';

/**
 * A League takes individual Tournaments only: League points belong to persons (rulings 729, 981).
 * The League doors and the database answer the same 409 reason, so one sentence names both; the
 * switch to team under a live League link has its own.
 */
const conflict = (reason: string): ApiFailure => ({
  kind: 'http',
  status: 409,
  detail: 'An English sentence from the API.',
  code: 'CONFLICT',
  details: { reason },
  validationErrors: null,
});

const en = createTranslator(getMessages('en'));
const fr = createTranslator(getMessages('fr'));

describe('the League refusals of a team Tournament', () => {
  it('a League link to a team Tournament says League points belong to persons', () => {
    expect(kindRefusal(conflict('team_tournament_league'), en)).toBe(
      'League points belong to persons.',
    );
    expect(kindRefusal(conflict('team_tournament_league'), fr)).toBe(
      'Les points de ligue appartiennent aux personnes.',
    );
  });

  it('a switch to team under a live League link says to remove the link first (ruling 981)', () => {
    expect(kindRefusal(conflict('league_link_blocks_team'), en)).toBe(
      'Remove the League link first: League points belong to persons.',
    );
    expect(kindRefusal(conflict('league_link_blocks_team'), fr)).toBe(
      "Retirez d'abord le lien à la ligue : les points de ligue appartiennent aux personnes.",
    );
  });
});

describe('the kind of a Tournament with a phase (ruling 983)', () => {
  it('a change of kind once the Tournament has Pools or a bracket says to delete them first', () => {
    expect(kindRefusal(conflict('kind_locked_by_phase'), en)).toBe(
      'Delete the Pools and the bracket first: a tournament keeps its kind once it has Pools or a bracket.',
    );
    expect(kindRefusal(conflict('kind_locked_by_phase'), fr)).toBe(
      "Supprimez d'abord les poules et le tableau : un tournoi garde son type dès qu'il a des poules ou un tableau.",
    );
  });
});
