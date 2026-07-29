/**
 * Events, themes, and lices.
 * Event = the gathering (FAL 2026, Swordfish 2027).
 */
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { penaltyRulesets } from './penalties';

// ── Events ────────────────────────────────────────────────────────────────────
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  city: text('city'),
  country: text('country'),
  startDate: text('start_date').notNull(), // ISO date
  endDate: text('end_date').notNull(), // ISO date
  // IANA timezone (migration 0102) — wall-clock times are entered/displayed in it.
  timezone: text('timezone').notNull().default('Europe/Paris'),
  status: text('status').notNull().default('draft'),
  // draft | published | running | completed | archived
  // What the event IS (migration 0162, replaced the is_test_event boolean of
  // 0113). standard | test | club, CHECK-constrained in SQL. Governs public
  // visibility, whether results are rated, and whether it can be hard-deleted.
  // See packages/types/src/event-kind.ts for the predicates and the full matrix.
  eventKind: text('event_kind').notNull().default('standard'),
  publicLandingMd: text('public_landing_md'),
  penaltyRulesetId: uuid('penalty_ruleset_id').references(() => penaltyRulesets.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Themes ────────────────────────────────────────────────────────────────────
export const themes = pgTable('themes', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  heroImageUrl: text('hero_image_url'),
  // NOTE: primary_color/secondary_color/accent_color/font_display/font_body/
  // custom_css were dropped from the live DB by migration 0086 (they were
  // write-only knobs no component read — the unified MyClash design governs
  // both apps now), and logo_url by 0084 (moved to events.logo_url). They were
  // left declared here as stale drift; removed 2026-07-17. hero_image_url is
  // the only per-event theme field that still flows to the public site.
});

// ── Lices (pistes / fighting arenas) ─────────────────────────────────────────
//
// `venue_id` (added in migration 0088) is declared as a plain UUID
// column here to avoid a circular import between events.ts and
// venues.ts. The FK constraint lives in the migration; Drizzle still
// sees a uuid column for type generation and queries.
export const lices = pgTable('lices', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  venueId: uuid('venue_id'),
  name: text('name').notNull(),
  locationLabel: text('location_label'),
  colorHex: text('color_hex'),
  sortOrder: integer('sort_order').notNull().default(0),
});
