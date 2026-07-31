/**
 * Tournaments, registrations, phases, pools, bracket slots.
 * Tournament = a competition within an event (one weapon, one ruleset).
 */
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
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

// ── Swiss rounds ──────────────────────────────────────────────────────────────
// A Swiss phase re-pairs the whole field every round, so it has rounds rather
// than pools or a slot tree. No `pools` rows are involved at all: there is no
// fixed group a fighter belongs to for the phase.
export const swissRounds = pgTable(
  'swiss_rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phaseId: uuid('phase_id')
      .notNull()
      .references(() => phases.id, { onDelete: 'cascade' }),
    roundNumber: integer('round_number').notNull(),
    status: text('status').notNull().default('pending'),
    // pending | running | completed
    byeRegistrationId: uuid('bye_registration_id').references(() => registrations.id, {
      onDelete: 'set null',
    }),
    // Ranked snapshot the pairing came from, engine warnings, manual adjustments.
    pairingMetaJson: jsonb('pairing_meta_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Also the backstop against two near-simultaneous match completions each
  // auto-committing the same next round: the second one gets 23505.
  (table) => [unique().on(table.phaseId, table.roundNumber)],
);

// ── Swiss entrants ────────────────────────────────────────────────────────────
// The phase roster, frozen at generation. Explicit rather than derived from
// registrations because a Swiss phase can be a CUT of the field — pools → Swiss
// → bracket is a valid three-stage tournament.
export const swissEntrants = pgTable(
  'swiss_entrants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phaseId: uuid('phase_id')
      .notNull()
      .references(() => phases.id, { onDelete: 'cascade' }),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id, { onDelete: 'cascade' }),
    // Excluded from later pairings; rounds already played still stand and still
    // count toward opponents' tiebreaks.
    withdrawnAtRound: integer('withdrawn_at_round'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.phaseId, table.registrationId)],
);

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

// ── Tournament phase venues ─────────────────────────────────────────────────
// Per-phase-type venue assignment (pools vs bracket) so a tournament can spread
// across venues. `phase_kind` is the pool/bracket taxonomy, NOT phases.type
// (which has no single "bracket" value and is created lazily). venue_id is a
// plain uuid (FK lives in migration 0108) to avoid a circular schema import,
// mirroring how lices.venue_id / event_venues are declared.
export const tournamentPhaseVenues = pgTable(
  'tournament_phase_venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    phaseKind: text('phase_kind').notNull(),
    // pool | bracket
    venueId: uuid('venue_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueTournamentPhaseKind: unique('tournament_phase_venues_tournament_id_phase_kind_key').on(
      table.tournamentId,
      table.phaseKind,
    ),
  }),
);

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
  workshopConflictWarning: boolean('workshop_conflict_warning').notNull().default(true),
  ratingBasedOrdering: boolean('rating_based_ordering').notNull().default(true),
  workloadBalance: boolean('workload_balance').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
