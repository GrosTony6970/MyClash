import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';

import { ageOf, typeBadge } from './queue-row-copy';

/**
 * A row of the review queue.
 *
 * Marc, a super admin, read "Exchange edit" for a request to void a hit and for
 * a request to restore one: opposite decisions under one word. The badge and the
 * age ("3 hours ago") were English literals, in front of a French reviewer.
 */
describe('the Type badge', () => {
  it('an exchange correction says what it asks of the hit', () => {
    expect(typeBadge({ type: 'exchange_edit', exchangeAction: 'void_exchange' })).toEqual({
      color: 'purple',
      labelKey: 'admin.reviewQueue.typeExchangeVoid',
    });
    expect(typeBadge({ type: 'exchange_edit', exchangeAction: 'revert_void_exchange' })).toEqual({
      color: 'purple',
      labelKey: 'admin.reviewQueue.typeExchangeRestore',
    });
  });

  // Whole keys: a key built from a prefix hides every orphan under it from the i18n sweep.
  it.each([
    ['deletion', 'blue', 'admin.reviewQueue.typeDeletion'],
    ['club_review', 'green', 'admin.reviewQueue.typeClubReview'],
    ['league_tournament_request', 'red', 'admin.reviewQueue.typeLeagueTournamentRequest'],
    ['league_membership_request', 'red', 'admin.reviewQueue.typeLeagueMembershipRequest'],
  ] as Array<[Parameters<typeof typeBadge>[0]['type'], string, string]>)(
    'a %s keeps its colour and gets its own key',
    (type, color, labelKey) => {
      expect(typeBadge({ type })).toEqual({ color, labelKey });
    },
  );

  it('every key is said in English and in French', () => {
    const keys = [
      'typeDeletion',
      'typeExchangeVoid',
      'typeExchangeRestore',
      'typeClubReview',
      'typeLeagueTournamentRequest',
      'typeLeagueMembershipRequest',
    ] as const;
    expect(keys.map((key) => en.admin.reviewQueue[key])).toEqual([
      'Deletion',
      'Void an exchange',
      'Restore an exchange',
      'Club review',
      'League request',
      'League join request',
    ]);
    expect(keys.map((key) => fr.admin.reviewQueue[key])).toEqual([
      'Suppression',
      'Invalider un échange',
      'Restaurer un échange',
      'Revue de club',
      'Demande de ligue',
      'Demande d’adhésion à une ligue',
    ]);
  });
});

describe('the age of a request', () => {
  const NOW = Date.parse('2026-10-04T12:00:00.000Z');
  const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

  it.each([
    [30, '30 seconds ago', 'il y a 30 secondes'],
    [60, '1 minute ago', 'il y a 1 minute'],
    [59 * 60, '59 minutes ago', 'il y a 59 minutes'],
    [3 * 3600, '3 hours ago', 'il y a 3 heures'],
    [24 * 3600, '1 day ago', 'il y a 1 jour'],
    [9 * 24 * 3600, '9 days ago', 'il y a 9 jours'],
  ])('%i seconds ago, in both languages', (seconds, english, french) => {
    expect(ageOf(ago(seconds), 'en-GB', NOW)).toBe(english);
    expect(ageOf(ago(seconds), 'fr-FR', NOW)).toBe(french);
  });

  it('a request stamped after this clock reads as now, not as the future', () => {
    expect(ageOf(ago(-5), 'en-GB', NOW)).toBe('0 seconds ago');
  });
});

describe('the row', () => {
  const row = readFileSync(join(__dirname, 'QueueRow.tsx'), 'utf8');

  it('says the badge and the age through the two owners', () => {
    expect(row).toMatch(/<SkillBadge color=\{badge\.color\} label=\{t\(badge\.labelKey\)\} \/>/);
    expect(row).toMatch(/\{ageOf\(item\.createdAt, localeToBcp47\(locale\)\)\}/);
  });

  it('holds no English of its own', () => {
    expect(row).not.toMatch(/ ago`|label: '/);
  });
});
