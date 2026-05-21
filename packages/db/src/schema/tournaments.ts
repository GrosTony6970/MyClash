/**
 * Tournaments, registrations, phases, pools, bracket slots.
 * Tournament = a competition within an event (one weapon, one ruleset).
 */
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { events } from './events';
import { fighters } from './fighters';
import { persons } from './persons';

// ── Tournaments ───────────────────────────────────────────────────────────────
export const tournaments = pgTable('tournaments', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  weapon: text('weapon'),
  category: text('category'),
  rulesetCode: text('ruleset_code').notNull().default('TF_v1'),
  rulesetVersion: text('ruleset_version').notNull().default('1'),
  rulesetConfig: jsonb('ruleset_config'),
  scoringConfig: jsonb('scoring_config_json'),
  lockConfig: jsonb('lock_config_json'),
  /** Optional identity color (ColorToken string). Rendered as a small bubble
   *  next to the tournament name across the admin UI. */
  color: text('color'),
  penaltyRulesetId: uuid('penalty_ruleset_id'),
  status: text('status').notNull().default('draft'),
  // draft | published | running | completed | archived
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Registrations ─────────────────────────────────────────────────────────────
export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  personId: uuid('person_id')
    .notNull()
    .references(() => persons.id, { onDelete: 'restrict' }),
  fighterId: uuid('fighter_id').references(() => fighters.id, { onDelete: 'set null' }),
  seed: integer('seed'),
  status: text('status').notNull().default('registered'),
  // registered | checked_in | withdrawn | disqualified
  bibNumber: integer('bib_number'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Phases ────────────────────────────────────────────────────────────────────
export const phases = pgTable('phases', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  // pool | single_elim | double_elim | swiss
  sortOrder: integer('sort_order').notNull().default(0),
  configJson: jsonb('config_json'),
  status: text('status').notNull().default('pending'),
  // pending | running | completed
  visibilityStatus: text('visibility_status').notNull().default('hidden'),
  // hidden | published
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedByUserId: uuid('published_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Pools ─────────────────────────────────────────────────────────────────────
export const pools = pgTable('pools', {
  id: uuid('id').primaryKey().defaultRandom(),
  phaseId: uuid('phase_id')
    .notNull()
    .references(() => phases.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

// ── Pool members ──────────────────────────────────────────────────────────────
export const poolMembers = pgTable('pool_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  poolId: uuid('pool_id')
    .notNull()
    .references(() => pools.id, { onDelete: 'cascade' }),
  registrationId: uuid('registration_id')
    .notNull()
    .references(() => registrations.id, { onDelete: 'cascade' }),
  seed: integer('seed'),
});

// ── Bracket slots ─────────────────────────────────────────────────────────────
export const bracketSlots = pgTable('bracket_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  phaseId: uuid('phase_id')
    .notNull()
    .references(() => phases.id, { onDelete: 'cascade' }),
  round: integer('round').notNull(),
  position: integer('position').notNull(),
  sourceAType: text('source_a_type'),
  sourceARef: text('source_a_ref'),
  sourceBType: text('source_b_type'),
  sourceBRef: text('source_b_ref'),
  registrationAId: uuid('registration_a_id').references(() => registrations.id, {
    onDelete: 'set null',
  }),
  registrationBId: uuid('registration_b_id').references(() => registrations.id, {
    onDelete: 'set null',
  }),
});

// ── Pool assignment settings ──────────────────────────────────────────────────
export const poolAssignmentSettings = pgTable('pool_assignment_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  tournamentId: uuid('tournament_id').references(() => tournaments.id, { onDelete: 'cascade' }),
  enforceSchoolSeparation: boolean('enforce_school_separation').notNull().default(true),
  schoolSeparationStrictness: text('school_separation_strictness').notNull().default('soft'),
  enforceSkillBalance: boolean('enforce_skill_balance').notNull().default(true),
  skillRatingSource: text('skill_rating_source').notNull().default('hema_ratings'),
  enforceRefereeNoBackToBack: boolean('enforce_referee_no_back_to_back').notNull().default(true),
  refereeRestMinSlots: integer('referee_rest_min_slots').notNull().default(1),
  enforceDedicatedRefereeRest: boolean('enforce_dedicated_referee_rest').notNull().default(true),
  enforceFighterRefereeNoOverlap: boolean('enforce_fighter_referee_no_overlap')
    .notNull()
    .default(true),
  preferHighRatedReferees: boolean('prefer_high_rated_referees').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
