/**
 * Leagues / Tournois Federaux.
 * Cross-event season standings fed by approved tournaments.
 */
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { fighters } from './fighters';
import { events } from './events';
import { tournaments } from './tournaments';

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  seasonYear: integer('season_year').notNull(),
  description: text('description'),
  logoUrl: text('logo_url'),
  status: text('status').notNull().default('draft'),
  publicVisibility: boolean('public_visibility').notNull().default(false),
  scoringSystem: text('scoring_system').notNull().default('ffamhe_tf_2026'),
  scoringConfig: jsonb('scoring_config')
    .notNull()
    .default({
      scoringSystem: 'ffamhe_tf_2026',
      rankingDimensions: 'weapon',
      tieBreakers: ['total_points', 'participation_count', 'medal_count', 'double_hit_average'],
    }),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leagueOrganizationRoles = pgTable('league_organization_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leagueUserRoles = pgTable('league_user_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leagueTournamentLinks = pgTable('league_tournament_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('requested'),
  requestedByUserId: uuid('requested_by_user_id').notNull(),
  reviewedByUserId: uuid('reviewed_by_user_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leagueTournamentResults = pgTable('league_tournament_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  fighterId: uuid('fighter_id')
    .notNull()
    .references(() => fighters.id, { onDelete: 'cascade' }),
  rankingGroupKey: text('ranking_group_key').notNull(),
  finalRank: integer('final_rank').notNull(),
  leaguePoints: integer('league_points').notNull().default(0),
  medal: text('medal'),
  doubleHits: integer('double_hits').notNull().default(0),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leagueRankings = pgTable('league_rankings', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  rankingGroupKey: text('ranking_group_key').notNull(),
  fighterId: uuid('fighter_id')
    .notNull()
    .references(() => fighters.id, { onDelete: 'cascade' }),
  rank: integer('rank').notNull(),
  totalPoints: integer('total_points').notNull().default(0),
  participationCount: integer('participation_count').notNull().default(0),
  medalCount: integer('medal_count').notNull().default(0),
  doubleHitsTotal: integer('double_hits_total').notNull().default(0),
  doubleHitAverage: text('double_hit_average').notNull().default('0'),
  perTournament: jsonb('per_tournament').notNull().default([]),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});
