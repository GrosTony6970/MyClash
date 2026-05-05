import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { matches } from './matches';
import { organizations } from './organizations';
import { registrations, tournaments } from './tournaments';

export const penaltyRulesets = pgTable('penalty_rulesets', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  version: text('version').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  ownerOrganizationId: uuid('owner_organization_id').references(() => organizations.id, {
    onDelete: 'cascade',
  }),
  builtIn: boolean('built_in').notNull().default(false),
  publicVisibility: boolean('public_visibility').notNull().default(false),
  accumulationScope: text('accumulation_scope').notNull().default('match'),
  csvSourceName: text('csv_source_name'),
  csvSourceSha256: text('csv_source_sha256'),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const penaltyRulesetEntries = pgTable('penalty_ruleset_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  rulesetId: uuid('ruleset_id')
    .notNull()
    .references(() => penaltyRulesets.id, { onDelete: 'cascade' }),
  groupNumber: integer('group_number').notNull(),
  refNumber: integer('ref_number').notNull(),
  shortName: text('short_name').notNull(),
  description: text('description').notNull(),
  sanctions: jsonb('sanctions').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const matchPenalties = pgTable('match_penalties', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientUuid: uuid('client_uuid').notNull().unique(),
  matchId: uuid('match_id')
    .notNull()
    .references(() => matches.id, { onDelete: 'cascade' }),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  registrationId: uuid('registration_id')
    .notNull()
    .references(() => registrations.id, { onDelete: 'cascade' }),
  rulesetId: uuid('ruleset_id').references(() => penaltyRulesets.id, { onDelete: 'set null' }),
  rulesetEntryId: uuid('ruleset_entry_id').references(() => penaltyRulesetEntries.id, {
    onDelete: 'set null',
  }),
  sequence: integer('sequence').notNull(),
  source: text('source').notNull().default('ruleset'),
  card: text('card').notNull(),
  groupNumber: integer('group_number'),
  refNumber: integer('ref_number'),
  shortName: text('short_name'),
  reason: text('reason'),
  scoreDelta: integer('score_delta').notNull().default(0),
  causesMatchForfeit: boolean('causes_match_forfeit').notNull().default(false),
  byUserId: uuid('by_user_id'),
  staffAccountId: uuid('staff_account_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  voided: boolean('voided').notNull().default(false),
  voidedReason: text('voided_reason'),
});

export const tournamentPenaltyReviews = pgTable('tournament_penalty_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  registrationId: uuid('registration_id')
    .notNull()
    .references(() => registrations.id, { onDelete: 'cascade' }),
  reviewType: text('review_type').notNull().default('second_black_card'),
  status: text('status').notNull().default('pending'),
  blackCardCount: integer('black_card_count').notNull().default(0),
  payloadJson: jsonb('payload_json').notNull().default({}),
  reviewedByUserId: uuid('reviewed_by_user_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
